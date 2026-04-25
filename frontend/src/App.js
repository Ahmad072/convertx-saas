import React, { useState } from 'react';
import axios from 'axios';

const API_URL = 'https://convertx-api-abc123.onrender.com'; // CHANGE THIS TO YOUR REAL RENDER URL
const APP_NAME = 'ConvertX';

function App() {
  const [file, setFile] = useState(null);
  const [converting, setConverting] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [message, setMessage] = useState('');

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      setDownloadUrl(null);
      setMessage('');
    }
  };

  const handleConvert = async () => {
    if (!file) {
      setMessage('Please select a file first');
      return;
    }

    setConverting(true);
    setMessage('Converting your file...');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await axios.post(`${API_URL}/api/convert`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      if (response.data && response.data.success) {
        setMessage('File converted successfully!');
        setDownloadUrl(`${API_URL}/api/download/${response.data.convertedFileName}`);
      } else {
        setMessage('Conversion failed. Please try again.');
      }
    } catch (error) {
      console.error('Error:', error);
      setMessage('Conversion failed. Please check your file and try again.');
    } finally {
      setConverting(false);
    }
  };

  return (
    <div style={{
      maxWidth: '650px',
      margin: '40px auto',
      padding: '30px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      background: 'white',
      borderRadius: '12px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.08)'
    }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '30px' }}>
        <h1 style={{ fontSize: '32px', color: '#4A90E2', margin: '0 0 10px 0' }}>
          📄 {APP_NAME}
        </h1>
        <p style={{ color: '#666', fontSize: '16px', margin: 0 }}>
          Convert any file to PDF - Free & Easy
        </p>
        <p style={{ color: '#999', fontSize: '13px', margin: '5px 0 0 0' }}>
          No signup required
        </p>
      </div>

      {/* Upload Area */}
      <div style={{
        border: '2px dashed #D1D5DB',
        borderRadius: '12px',
        padding: '40px 20px',
        textAlign: 'center',
        background: '#F9FAFB',
        marginBottom: '20px'
      }}>
        <div style={{ fontSize: '48px', marginBottom: '15px' }}>📁</div>
        
        <input
          type="file"
          onChange={handleFileChange}
          style={{ marginBottom: '20px', fontSize: '14px' }}
          accept=".doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.webp,.txt,.html,.htm,.rtf,.odt"
        />
        
        <br />
        
        <button
          onClick={handleConvert}
          disabled={converting || !file}
          style={{
            padding: '14px 40px',
            background: converting || !file ? '#D1D5DB' : '#4A90E2',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '18px',
            fontWeight: '600',
            cursor: converting || !file ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s'
          }}
        >
          {converting ? '⏳ Converting...' : '🔄 Convert to PDF'}
        </button>

        {file && (
          <p style={{ marginTop: '15px', color: '#666', fontSize: '14px' }}>
            Selected: {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
          </p>
        )}
      </div>

      {/* Message */}
      {message && (
        <div style={{
          padding: '15px',
          borderRadius: '8px',
          textAlign: 'center',
          fontWeight: '500',
          marginBottom: '20px',
          background: message.includes('success') ? '#D1FAE5' : message.includes('failed') ? '#FEE2E2' : '#EBF3FC',
          color: message.includes('success') ? '#065F46' : message.includes('failed') ? '#991B1B' : '#1E40AF'
        }}>
          {message}
        </div>
      )}

      {/* Download Button */}
      {downloadUrl && (
        <div style={{ textAlign: 'center' }}>
          <a
            href={downloadUrl}
            download
            style={{
              display: 'inline-block',
              padding: '14px 40px',
              background: '#10B981',
              color: 'white',
              textDecoration: 'none',
              borderRadius: '8px',
              fontSize: '18px',
              fontWeight: '600',
              transition: 'all 0.2s'
            }}
            onMouseOver={(e) => e.target.style.background = '#059669'}
            onMouseOut={(e) => e.target.style.background = '#10B981'}
          >
            ⬇️ Download PDF
          </a>
          <p style={{ color: '#999', fontSize: '13px', marginTop: '10px' }}>
            Click to download your converted PDF file
          </p>
        </div>
      )}

      {/* Footer */}
      <div style={{
        textAlign: 'center',
        marginTop: '30px',
        paddingTop: '20px',
        borderTop: '1px solid #E5E7EB',
        color: '#999',
        fontSize: '13px'
      }}>
        <p style={{ margin: 0 }}>{APP_NAME} - Convert any file to PDF instantly</p>
        <p style={{ margin: '5px 0 0 0' }}>Supports: DOC, DOCX, XLS, XLSX, JPG, PNG, GIF, TXT, HTML</p>
      </div>
    </div>
  );
}

export default App;
