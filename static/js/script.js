let authToken = null;
let selectedFile = null;
let validationResult = null;

const step0 = document.getElementById('step0');
const step1 = document.getElementById('step1');
const step2 = document.getElementById('step2');

const tokenInput = document.getElementById('tokenInput');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const previewBox = document.getElementById('previewBox');
const errorList = document.getElementById('errorList');
const contactCount = document.getElementById('contactCount');
const vcfFileName = document.getElementById('vcfFileName');
const convertBtn = document.getElementById('convertBtn');
const backBtn = document.getElementById('backBtn');
const loading = document.getElementById('loading');
const loadingText = document.getElementById('loadingText');
const successMessage = document.getElementById('successMessage');
const errorMessage = document.getElementById('errorMessage');
const warningMessage = document.getElementById('warningMessage');

// Login
loginBtn.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    if (!token) {
        showError('Token tidak boleh kosong!');
        return;
    }
    
    authToken = token;
    
    try {
        const response = await fetch('/validate-token', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.ok) {
            step0.classList.remove('active');
            step1.classList.add('active');
            logoutBtn.style.display = 'block';
            showSuccess('Login berhasil! Silakan upload file TXT.');
        } else {
            authToken = null;
            showError('Token tidak valid!');
        }
    } catch (error) {
        authToken = null;
        showError('Koneksi gagal. Coba lagi.');
    }
});

// Logout
logoutBtn.addEventListener('click', () => {
    authToken = null;
    tokenInput.value = '';
    resetForm();
    step1.classList.remove('active');
    step2.classList.remove('active');
    step0.classList.add('active');
    logoutBtn.style.display = 'none';
    hideMessages();
});

// Upload area interactions
uploadArea.addEventListener('click', () => fileInput.click());

uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
});

uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
});

uploadArea.addEventListener('drop', async (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        await handleFileSelect(files[0]);
    }
});

fileInput.addEventListener('change', async (e) => {
    if (e.target.files.length > 0) {
        await handleFileSelect(e.target.files[0]);
    }
});

async function handleFileSelect(file) {
    if (!authToken) {
        showError('Silakan login terlebih dahulu!');
        return;
    }
    
    // Validasi ukuran
    if (file.size > 10 * 1024 * 1024) {
        showError('File terlalu besar! Maksimal 10MB');
        return;
    }
    
    hideMessages();
    loading.classList.add('show');
    loadingText.textContent = 'Memvalidasi file...';
    
    try {
        const formData = new FormData();
        formData.append('file', file);
        
        const response = await fetch('/validate', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`
            },
            body: formData
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            showError(result.detail || 'Validasi gagal');
            loading.classList.remove('show');
            return;
        }
        
        if (result.valid_count === 0) {
            showError('❌ File ditolak! Yang bener atuh formatnya.');
            if (result.invalid_lines && result.invalid_lines.length > 0) {
                errorList.innerHTML = '<h4>Detail error:</h4>';
                result.invalid_lines.forEach(err => {
                    const item = document.createElement('div');
                    item.className = 'error-item';
                    item.textContent = `Baris ${err.line}: ${err.error}`;
                    errorList.appendChild(item);
                });
                errorList.style.display = 'block';
            }
            loading.classList.remove('show');
            return;
        }
        
        // Simpan hasil validasi
        selectedFile = file;
        validationResult = result;
        
        // Tampilkan preview
        displayPreview(result);
        
        // Auto-generate nama file
        const baseName = file.name.replace('.txt', '').replace(/[^a-z0-9_-]/gi, '_');
        vcfFileName.value = baseName;
        
        // Pindah ke step 2
        step1.classList.remove('active');
        step2.classList.add('active');
        
        if (result.invalid_count > 0) {
            showWarning(`⚠️ ${result.invalid_count} baris diabaikan. ${result.valid_count} kontak akan dikonversi.`);
        }
        
    } catch (error) {
        showError('Koneksi gagal. Coba lagi.');
    } finally {
        loading.classList.remove('show');
    }
}

function displayPreview(result) {
    contactCount.textContent = `${result.valid_count} kontak`;
    
    previewBox.innerHTML = '';
    const previewLimit = 10;
    const contacts = result.valid_contacts.slice(0, previewLimit);
    
    contacts.forEach(contact => {
        const item = document.createElement('div');
        item.className = 'contact-item';
        item.innerHTML = `
            <span class="contact-name">${escapeHtml(contact[0])}</span>
            <span class="contact-number">${escapeHtml(contact[1])}</span>
        `;
        previewBox.appendChild(item);
    });
    
    if (result.valid_count > previewLimit) {
        const more = document.createElement('div');
        more.className = 'contact-item';
        more.style.color = '#888';
        more.style.fontStyle = 'italic';
        more.textContent = `... dan ${result.valid_count - previewLimit} kontak lainnya`;
        previewBox.appendChild(more);
    }
    
    // Tampilkan error jika ada
    if (result.invalid_count > 0 && result.invalid_lines) {
        errorList.innerHTML = '<h4>Baris yang diabaikan:</h4>';
        result.invalid_lines.forEach(err => {
            const item = document.createElement('div');
            item.className = 'error-item';
            item.textContent = `Baris ${err.line}: ${err.error}`;
            errorList.appendChild(item);
        });
        errorList.style.display = 'block';
    } else {
        errorList.style.display = 'none';
    }
}

// Back button
backBtn.addEventListener('click', () => {
    step2.classList.remove('active');
    step1.classList.add('active');
    selectedFile = null;
    validationResult = null;
    fileInput.value = '';
    hideMessages();
});

// Convert & Download
convertBtn.addEventListener('click', async () => {
    const customName = vcfFileName.value.trim();
    
    if (!customName) {
        showError('Nama file tidak boleh kosong!');
        return;
    }
    
    if (!/^[a-z0-9_-]+$/i.test(customName)) {
        showError('Nama file hanya boleh berisi huruf, angka, _ dan -');
        return;
    }
    
    convertBtn.disabled = true;
    loading.classList.add('show');
    loadingText.textContent = 'Membuat file VCF...';
    hideMessages();
    
    try {
        const formData = new FormData();
        formData.append('file', selectedFile);
        formData.append('filename', customName);
        
        const response = await fetch('/convert', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`
            },
            body: formData
        });
        
        if (response.status === 429) {
            const data = await response.json();
            showError(data.detail);
            loading.classList.remove('show');
            convertBtn.disabled = false;
            return;
        }
        
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = customName + '.vcf';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            showSuccess(`✅ Download berhasil! File: ${customName}.vcf`);
            
            setTimeout(() => {
                resetForm();
                step2.classList.remove('active');
                step1.classList.add('active');
                successMessage.classList.remove('show');
            }, 3000);
        } else {
            const data = await response.json();
            showError(data.detail || 'Terjadi kesalahan');
        }
    } catch (error) {
        showError('Koneksi gagal. Coba lagi.');
    } finally {
        loading.classList.remove('show');
        convertBtn.disabled = false;
    }
});

// Enter key support
vcfFileName.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        convertBtn.click();
    }
});

tokenInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        loginBtn.click();
    }
});

function resetForm() {
    fileInput.value = '';
    vcfFileName.value = '';
    selectedFile = null;
    validationResult = null;
    previewBox.innerHTML = '';
    errorList.innerHTML = '';
    errorList.style.display = 'none';
}

function showSuccess(msg) {
    hideMessages();
    successMessage.textContent = msg;
    successMessage.classList.add('show');
}

function showError(msg) {
    hideMessages();
    errorMessage.textContent = msg;
    errorMessage.classList.add('show');
}

function showWarning(msg) {
    hideMessages();
    warningMessage.textContent = msg;
    warningMessage.classList.add('show');
}

function hideMessages() {
    successMessage.classList.remove('show');
    errorMessage.classList.remove('show');
    warningMessage.classList.remove('show');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}