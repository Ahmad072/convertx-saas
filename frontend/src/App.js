import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import axios from 'axios';
import './App.css';

const API_URL = 'https://convertx-saas.onrender.com/'; // CHANGE THIS!
const APP_NAME = 'ConvertX';

function App() {
  const [converting, setConverting] = useState(false);
  const [message, setMessage] = useState(null);
  const [lastFile, setLastFile] = useState(null);

  const onDrop = useCallback(async (acceptedFiles) => {
    if (acceptedFiles.length === 0) return;

    const file = acceptedFiles[0];
    setConverting(true);
    setMessage(null);
    setLastFile(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await axios.post(`${API_URL}/api/convert`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      setMessage({ 
        type: 'success', 
        text: '✅ File converted successfully!' 
      });
      
      setLastFile({
        name: res.data.fileName,
        downloadUrl: `${API_URL}/api/download/${res.data.convertedFileName}`
      });

    } catch (error) {
      console.error('Error:', error);
      setMessage({ 
        type: 'error', 
        text: error.response?.data?.error || '❌ Conversion failed. Please try again.' 
      });
    } finally {
      setConverting(false);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxSize: 52428800
  });

  return (
    <div className="app-container">
      {/* Navbar */}
      <nav className="navbar">
        <div className="nav-brand">
          <span className="nav-logo">📄</span>
          <span className="nav-title">{APP_NAME}</span>
          <span className="nav-badge">FREE</span>
        </div>
        <div className="nav-user">
          <span className="counter-label">20 files/day</span>
        </div>
      </nav>

      {/* Main */}
      <main className="main-content">
        <div className="upload-section">
          <h2 className="section-title">📁 Convert File to PDF</h2>
          <p className="section-subtitle">Free • No signup required • 20 files per day</p>
          
          <div 
            {...getRootProps()} 
            className={`dropzone ${isDragActive ? 'dropzone-active' : ''} ${converting ? 'dropzone-converting' : ''}`}
          >
            <input {...getInputProps()} />
            
            {converting ? (
              <div className="dropzone-content">
                <div className="spinner" />
                <p className="dropzone-text">Converting your file...</p>
              </div>
            ) : (
              <div className="dropzone-content">
                <div className="dropzone-icon">{isDragActive ? '📂' : '📁'}</div>
                <p className="dropzone-text">
                  {isDragActive ? 'Drop your file here' : 'Drag & drop your file here'}
                </p>
                <p className="dropzone-subtext">or click to browse</p>
                <div className="supported-formats">
                  <span>DOC</span><span>DOCX</span><span>JPG</span><span>PNG</span><span>TXT</span><span>HTML</span>
                </div>
                <p className="file-size-limit">Max 50MB</p>
              </div>
            )}
          </div>
        </div>

        {/* Messages */}
        {message && (
          <div className={`message message-${message.type}`} style={{ marginTop: '20px' }}>
            <span>{message.text}</span>
          </div>
        )}

        {/* Download Button */}
        {lastFile && (
          <div className="download-card">
            <h3>✅ Ready to Download</h3>
            <p>{lastFile.name}</p>
            <a 
              href={lastFile.downloadUrl}
              className="btn-download"
              download
            >
              ⬇️ Download PDF
            </a>
          </div>
        )}
      </main>

      <footer className="footer">
        <p>&copy; 2024 {APP_NAME} • Free File to PDF Converter</p>
      </footer>
    </div>
  );
}

export default App;
