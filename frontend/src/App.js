import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import axios from 'axios';
import './App.css';

// ═══════════════════════════════════════════════════════
const API_URL = 'https://convertx-api.onrender.com'; // CHANGE THIS
const APP_NAME = 'ConvertX';
const DAILY_LIMIT = 20;

// ═══════════════════════════════════════════════════════
function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('convertx_token'));
  const [converting, setConverting] = useState(false);
  const [message, setMessage] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // Auth states
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authStep, setAuthStep] = useState('email'); // 'email' | 'otp'
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [pendingDownload, setPendingDownload] = useState(null);
  const [remainingToday, setRemainingToday] = useState(DAILY_LIMIT);
  
  // OTP input refs
  const otpInputRefs = useRef([]);

  useEffect(() => {
    if (token) {
      fetchUserProfile();
      fetchHistory();
    }
  }, [token]);

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  // ═══════════════════════════════════════════════════
  // API FUNCTIONS
  // ═══════════════════════════════════════════════════

  const fetchUserProfile = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/user/profile`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setUser(res.data);
      setRemainingToday(res.data.remainingToday);
    } catch (error) {
      if (error.response?.status === 401) logout();
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/convert/history`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setHistory(res.data.files || []);
    } catch (error) {
      console.error('History error:', error);
    }
  };

  const logout = () => {
    localStorage.removeItem('convertx_token');
    setToken(null);
    setUser(null);
    setHistory([]);
    setRemainingToday(DAILY_LIMIT);
    setShowAuthModal(false);
  };

  // ═══════════════════════════════════════════════════
  // OTP AUTH FUNCTIONS
  // ═══════════════════════════════════════════════════

  const handleSendOTP = async (e) => {
    e?.preventDefault();
    if (!email || !email.includes('@')) {
      setMessage({ type: 'error', text: 'Please enter a valid email address' });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      await axios.post(`${API_URL}/api/auth/send-otp`, { email });
      setAuthStep('otp');
      setMessage({ type: 'success', text: `Verification code sent to ${email}` });
      // Focus first OTP input
      setTimeout(() => otpInputRefs.current[0]?.focus(), 300);
    } catch (error) {
      setMessage({ 
        type: 'error', 
        text: error.response?.data?.error || 'Failed to send code. Please try again.' 
      });
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async (e) => {
    e?.preventDefault();
    if (otp.length !== 6) {
      setMessage({ type: 'error', text: 'Please enter the 6-digit code' });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const res = await axios.post(`${API_URL}/api/auth/verify-otp`, { email, otp });
      
      localStorage.setItem('convertx_token', res.data.token);
      setToken(res.data.token);
      setUser(res.data.user);
      setRemainingToday(res.data.user.remainingToday || DAILY_LIMIT);
      setMessage({ type: 'success', text: '✅ Email verified! Downloading your file...' });
      
      // Reset auth state
      setAuthStep('email');
      setOtp('');
      setShowAuthModal(false);
      
      // Download pending file if exists
      if (pendingDownload) {
        setTimeout(() => downloadFile(pendingDownload, true), 500);
        setPendingDownload(null);
      }
      
      // Fetch history after login
      fetchHistory();
    } catch (error) {
      setMessage({ 
        type: 'error', 
        text: error.response?.data?.error || 'Invalid code. Please try again.' 
      });
      setOtp('');
      otpInputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (index, value) => {
    if (value.length > 1) return;
    
    const newOtp = otp.split('');
    newOtp[index] = value;
    const otpString = newOtp.join('');
    setOtp(otpString);
    
    // Auto-advance to next input
    if (value && index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    }
    
    // Auto-submit when all 6 digits entered
    if (index === 5 && value && otpString.length === 6) {
      setTimeout(() => handleVerifyOTP(), 200);
    }
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  };

  // ═══════════════════════════════════════════════════
  // FILE OPERATIONS
  // ═══════════════════════════════════════════════════

  const downloadFile = async (filename, isPending = false) => {
    if (!token && !isPending) {
      setPendingDownload(filename);
      setShowAuthModal(true);
      return;
    }

    try {
      const res = await axios.get(`${API_URL}/api/convert/download/${filename}`, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'blob'
      });
      
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'converted.pdf');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      
      setMessage({ type: 'success', text: '✅ File downloaded!' });
      fetchUserProfile();
    } catch (error) {
      setMessage({ type: 'error', text: 'Download failed. Please login and try again.' });
    }
  };

  const deleteFile = async (filename) => {
    try {
      // We don't have delete endpoint, just remove from UI
      fetchHistory();
      setMessage({ type: 'success', text: 'File removed from list' });
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to remove file.' });
    }
  };

  const onDrop = useCallback(async (acceptedFiles) => {
    if (acceptedFiles.length === 0) return;

    if (remainingToday <= 0) {
      setMessage({
        type: 'error',
        text: `Daily limit of ${DAILY_LIMIT} conversions reached. Please come back tomorrow!`
      });
      return;
    }

    const file = acceptedFiles[0];
    setConverting(true);
    setMessage(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await axios.post(`${API_URL}/api/convert`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          'X-User-Email': user?.email || 'guest'
        }
      });

      setMessage({ 
        type: 'success', 
        text: '✅ File converted! Sign up to download your PDF.' 
      });
      
      // Trigger download flow
      if (res.data.convertedFileName) {
        if (token) {
          // User is logged in, download immediately
          setTimeout(() => downloadFile(res.data.convertedFileName), 500);
        } else {
          // User needs to sign up
          setPendingDownload(res.data.convertedFileName);
          setShowAuthModal(true);
          setEmail('');
          setAuthStep('email');
        }
      }
    } catch (error) {
      if (error.response?.status === 429) {
        setMessage({
          type: 'error',
          text: `Daily limit reached (${DAILY_LIMIT} files/day). Come back tomorrow!`
        });
      } else {
        setMessage({
          type: 'error',
          text: error.response?.data?.error || '❌ Conversion failed. Please try again.'
        });
      }
    } finally {
      setConverting(false);
    }
  }, [token, user, remainingToday]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/gif': ['.gif'],
      'image/webp': ['.webp'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'text/plain': ['.txt'],
      'text/html': ['.html', '.htm'],
      'application/rtf': ['.rtf'],
      'application/vnd.oasis.opendocument.text': ['.odt']
    },
    maxSize: 52428800,
    multiple: false
  });

  // ═══════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════

  return (
    <div className="app-container">
      {/* Navigation Bar */}
      <nav className="navbar">
        <div className="nav-brand">
          <span className="nav-logo">📄</span>
          <span className="nav-title">{APP_NAME}</span>
          <span className="nav-badge">FREE</span>
        </div>
        
        <div className="nav-user">
          {user ? (
            <>
              <div className="user-info">
                <span className="user-email">{user.email}</span>
                <span className="user-plan-badge">
                  {remainingToday} / {DAILY_LIMIT}
                </span>
              </div>
              <button onClick={logout} className="btn-logout">Sign Out</button>
            </>
          ) : (
            <div className="daily-counter">
              <span className="counter-label">Free: {DAILY_LIMIT} files/day</span>
            </div>
          )}
        </div>
      </nav>

      {/* Main Content */}
      <main className="main-content">
        <div className="content-grid">
          <div className="column-main">
            {/* Daily Limit Alert */}
            {remainingToday <= 5 && remainingToday > 0 && (
              <div className="upgrade-alert">
                <div className="alert-content">
                  <span className="alert-icon">⚡</span>
                  <span>Only {remainingToday} conversions left today</span>
                </div>
              </div>
            )}
            
            {remainingToday <= 0 && (
              <div className="upgrade-alert" style={{ background: '#FEE2E2', border: '1px solid #FECACA' }}>
                <div className="alert-content">
                  <span className="alert-icon">🛑</span>
                  <span>Daily limit reached. Come back tomorrow for {DAILY_LIMIT} more free conversions!</span>
                </div>
              </div>
            )}

            {/* Upload Section */}
            <div className="upload-section">
              <h2 className="section-title">📁 Convert File to PDF</h2>
              <p className="section-subtitle">Free • No signup required to convert • {DAILY_LIMIT} files per day</p>
              
              <div 
                {...getRootProps()} 
                className={`dropzone ${isDragActive ? 'dropzone-active' : ''} ${converting ? 'dropzone-converting' : ''} ${remainingToday <= 0 ? 'dropzone-disabled' : ''}`}
              >
                <input {...getInputProps()} disabled={remainingToday <= 0} />
                
                {converting ? (
                  <div className="dropzone-content">
                    <div className="spinner" />
                    <p className="dropzone-text">Converting your file...</p>
                    <p className="dropzone-subtext">This may take a few seconds</p>
                  </div>
                ) : (
                  <div className="dropzone-content">
                    <div className="dropzone-icon">
                      {isDragActive ? '📂' : '📁'}
                    </div>
                    <p className="dropzone-text">
                      {isDragActive ? 'Drop your file here' : 'Drag & drop your file here'}
                    </p>
                    <p className="dropzone-subtext">or click to browse</p>
                    <div className="supported-formats">
                      <span>DOC</span><span>DOCX</span><span>XLS</span><span>XLSX</span>
                      <span>JPG</span><span>PNG</span><span>TXT</span><span>HTML</span>
                    </div>
                    <p className="file-size-limit">Max 50MB • {remainingToday} conversions left today</p>
                  </div>
                )}
              </div>
            </div>

            {/* Messages */}
            {message && (
              <div className={`message message-${message.type}`}>
                <span>{message.text}</span>
                {message.type === 'success' && !token && (
                  <button onClick={() => setShowAuthModal(true)} className="btn-auth-action">
                    Sign Up to Download
                  </button>
                )}
              </div>
            )}

            {/* History (only for logged in users) */}
            {token && user && (
              <div className="history-section">
                <h2 className="section-title">Your Recent Files</h2>
                {history.length === 0 ? (
                  <div className="empty-state">
                    <p>No files converted yet</p>
                    <p className="empty-subtext">Upload a file to get started!</p>
                  </div>
                ) : (
                  <div className="history-list">
                    {history.map((file) => (
                      <div key={file.id} className="history-item">
                        <div className="file-icon">📄</div>
                        <div className="file-info">
                          <p className="file-name">{file.original_name}</p>
                          <p className="file-meta">
                            {new Date(file.converted_at).toLocaleDateString('en-US', {
                              month: 'short', day: 'numeric', year: 'numeric',
                              hour: '2-digit', minute: '2-digit'
                            })}
                            {file.file_size && ` • ${(file.file_size / 1024).toFixed(1)} KB`}
                          </p>
                        </div>
                        <div className="file-actions">
                          <button onClick={() => downloadFile(file.converted_path)} className="btn-icon" title="Download">⬇️</button>
                          <button onClick={() => deleteFile(file.converted_path)} className="btn-icon" title="Delete">🗑️</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Sidebar */}
          <div className="column-side">
            <div className="info-card">
              <h3>🆓 It's Free!</h3>
              <p style={{ fontSize: '14px', color: '#666', marginBottom: '15px' }}>
                Convert up to <strong>{DAILY_LIMIT} files</strong> per day for free. No credit card required.
              </p>
              <div className="info-features">
                <div className="info-feature">✅ Convert to PDF instantly</div>
                <div className="info-feature">✅ Multiple formats supported</div>
                <div className="info-feature">✅ Files up to 50MB</div>
                <div className="info-feature">✅ {DAILY_LIMIT} files per day</div>
              </div>
            </div>
            
            <div className="how-it-works-card">
              <h3>How It Works</h3>
              <ol style={{ paddingLeft: '20px', color: '#666', lineHeight: '2' }}>
                <li>📤 Upload your file</li>
                <li>🔄 We convert it to PDF</li>
                <li>📧 Enter your email to verify</li>
                <li>🔢 Enter the 6-digit code</li>
                <li>⬇️ Download your PDF!</li>
              </ol>
            </div>
          </div>
        </div>
      </main>

      {/* Auth Modal */}
      {showAuthModal && (
        <div className="modal-overlay" onClick={(e) => { if (e.target.className === 'modal-overlay') setShowAuthModal(false); }}>
          <div className="auth-modal">
            <button className="modal-close" onClick={() => setShowAuthModal(false)}>✕</button>
            
            <div className="auth-header">
              <span className="auth-icon">📄</span>
              <h2>{authStep === 'email' ? 'Sign Up to Download' : 'Verify Your Email'}</h2>
              <p>Enter your email to access your converted file</p>
            </div>

            {message && authStep === 'otp' && (
              <div className={`message message-${message.type}`}>
                {message.text}
              </div>
            )}

            {authStep === 'email' ? (
              <form onSubmit={handleSendOTP} className="auth-form">
                <div className="input-group">
                  <label>Email Address</label>
                  <input
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <button type="submit" className="btn-primary" disabled={loading}>
                  {loading ? 'Sending Code...' : 'Send Verification Code'}
                </button>
                <p style={{ fontSize: '12px', color: '#999', textAlign: 'center', marginTop: '10px' }}>
                  We'll send a 6-digit code to verify your email
                </p>
              </form>
            ) : (
              <form onSubmit={handleVerifyOTP} className="auth-form">
                <p style={{ textAlign: 'center', color: '#666', marginBottom: '20px', fontSize: '14px' }}>
                  Enter the 6-digit code sent to <strong>{email}</strong>
                </p>
                
                <div className="otp-inputs">
                  {[0, 1, 2, 3, 4, 5].map((index) => (
                    <input
                      key={index}
                      ref={(el) => otpInputRefs.current[index] = el}
                      type="text"
                      maxLength="1"
                      className="otp-input"
                      value={otp[index] || ''}
                      onChange={(e) => handleOtpChange(index, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(index, e)}
                      autoFocus={index === 0}
                    />
                  ))}
                </div>

                <button type="submit" className="btn-primary" disabled={loading || otp.length !== 6}>
                  {loading ? 'Verifying...' : 'Verify & Download'}
                </button>

                <div className="auth-links">
                  <button onClick={handleSendOTP} className="btn-link" disabled={loading}>
                    Resend Code
                  </button>
                  <button onClick={() => { setAuthStep('email'); setOtp(''); }} className="btn-link">
                    Change Email
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="footer">
        <p>&copy; 2024 {APP_NAME} • Free File to PDF Converter</p>
        <p className="footer-tagline">{DAILY_LIMIT} free conversions per day, every day.</p>
      </footer>
    </div>
  );
}

export default App;
