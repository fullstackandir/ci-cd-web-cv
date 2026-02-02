import os
import time
import re
from datetime import datetime
from pathlib import Path
from typing import Dict
from collections import defaultdict
from fastapi import FastAPI, UploadFile, File, Form, Depends, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

app = FastAPI(title="TXT to VCF Converter")

# Configuration
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

# Mount static files and templates
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# Simple token storage (gunakan database untuk production)
VALID_TOKENS = {
    "uqon123": {"username": "uqon123", "created": datetime.now()},
}

# Rate limiting storage
rate_limit_storage: Dict[str, list] = defaultdict(list)
RATE_LIMIT_MAX = 10  # 10 requests
RATE_LIMIT_WINDOW = 3600  # per hour

security = HTTPBearer()

def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    token = credentials.credentials
    if token not in VALID_TOKENS:
        raise HTTPException(status_code=401, detail="Invalid token")
    return VALID_TOKENS[token]

def check_rate_limit(request: Request):
    client_ip = request.client.host
    current_time = time.time()
    
    # Clean old requests
    rate_limit_storage[client_ip] = [
        req_time for req_time in rate_limit_storage[client_ip]
        if current_time - req_time < RATE_LIMIT_WINDOW
    ]
    
    # Check limit
    if len(rate_limit_storage[client_ip]) >= RATE_LIMIT_MAX:
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded. Max {RATE_LIMIT_MAX} requests per hour."
        )
    
    # Add current request
    rate_limit_storage[client_ip].append(current_time)

def normalize_number(n: str):
    n = re.sub(r"\D", "", n)
    if len(n) < 9:
        return None
    return "+" + n

def validate_txt_content(content: str) -> dict:
    """Validasi isi file TXT dan return hasil analisis"""
    lines = content.split('\n')
    valid_contacts = []
    invalid_lines = []
    
    for idx, line in enumerate(lines, 1):
        line = line.strip()
        if not line:
            continue
            
        if '|' not in line:
            invalid_lines.append({
                "line": idx,
                "content": line[:50],
                "error": "Tidak ada tanda pemisah |"
            })
            continue
        
        parts = line.split('|', 1)
        if len(parts) < 2:
            invalid_lines.append({
                "line": idx,
                "content": line[:50],
                "error": "Format salah"
            })
            continue
        
        name = parts[0].strip()
        number = parts[1].strip()
        
        if not name:
            invalid_lines.append({
                "line": idx,
                "content": line[:50],
                "error": "Nama kosong"
            })
            continue
        
        if not number:
            invalid_lines.append({
                "line": idx,
                "content": line[:50],
                "error": "Nomor kosong"
            })
            continue
        
        # Validasi format nomor
        if not re.match(r'^[\d\s\-\+\(\)]+$', number):
            invalid_lines.append({
                "line": idx,
                "content": line[:50],
                "error": f"Nomor tidak valid: {number}"
            })
            continue
        
        normalized = normalize_number(number)
        if not normalized:
            invalid_lines.append({
                "line": idx,
                "content": line[:50],
                "error": "Nomor terlalu pendek"
            })
            continue
        
        valid_contacts.append((name, normalized))
    
    return {
        "valid_count": len(valid_contacts),
        "invalid_count": len(invalid_lines),
        "valid_contacts": valid_contacts,
        "invalid_lines": invalid_lines[:10]  # Hanya 10 error pertama
    }

# Routes
@app.get("/")
async def home(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/validate-token")
async def validate_token_endpoint(user: dict = Depends(verify_token)):
    return {"status": "valid", "username": user["username"]}

@app.post("/validate")
async def validate_file(
    request: Request,
    file: UploadFile = File(...),
    user: dict = Depends(verify_token)
):
    check_rate_limit(request)
    
    try:
        content = (await file.read()).decode('utf-8')
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="File harus berformat UTF-8")
    
    result = validate_txt_content(content)
    
    return result

@app.post("/convert")
async def convert(
    request: Request,
    file: UploadFile = File(...),
    filename: str = Form(...),
    user: dict = Depends(verify_token)
):
    check_rate_limit(request)
    
    try:
        content = (await file.read()).decode('utf-8')
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="File harus berformat UTF-8")
    
    result = validate_txt_content(content)
    
    if result["valid_count"] == 0:
        raise HTTPException(status_code=400, detail="Tidak ada kontak valid")
    
    # Sanitize filename
    safe_filename = re.sub(r'[^a-z0-9_-]', '_', filename.lower())
    vcf_path = UPLOAD_DIR / f"{safe_filename}_{int(time.time())}.vcf"
    
    with open(vcf_path, "w", encoding="utf-8") as vcf:
        for name, number in result["valid_contacts"]:
            vcf.write(
                "BEGIN:VCARD\n"
                "VERSION:3.0\n"
                f"N:{name};;;;\n"
                f"FN:{name}\n"
                f"TEL;TYPE=CELL:{number}\n"
                "END:VCARD\n"
            )
    
    return FileResponse(
        path=vcf_path,
        filename=f"{safe_filename}.vcf",
        media_type="text/vcard"
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=2222)
   
