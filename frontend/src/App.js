import React, { useState, useEffect, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import axios from 'axios';
import './App.css';

// ═══════════════════════════════════════════════════════
// CONFIGURATION - Change this to your Render backend URL
// ═══════════════════════════════════════════════════════
const API_URL = 'https://convertx-api.onrender.com';
const APP_NAME = 'ConvertX';
const FREE_LIMIT = 3;
const PRO_PRICE = 8;

// ═══════════════════════════════════════════════════════
// MAIN APP COMPONENT
// ═══════════════════════════════════════════════════════
function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('convertx_token'));
  const [authMode, setAuthMode] = useState('login'); // 'login' or 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [converting, setConverting] = useState(false);
  const [message, setMessage] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showPricing, setShowPricing] = useState(false);

  // Load user data on token change
  useEffect(() => {
    if (token) {
      fetchUserProfile();
      fetchHistory();
    }
  }, [token]);

  // Auto-dismiss messages
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 5000);
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
    } catch (error) {
      if (error.response?.status === 401) {
        logout();
      }
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/convert/history`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setHistory(res.data.files || []);
    } catch (error) {
      console.error('Failed to fetch history');
    }
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const payload = authMode === 'login' 
        ? { email, password }
        : { email, password, name };

      const res = await axios.post(`${API_URL}${endpoint}`, payload);
      
      localStorage.setItem('convertx_token', res.data.token);
      setToken(res.data.token);
      setUser(res.data.user);
      setMessage({ type: 'success', text: `Welcome to ${APP_NAME}, ${res.data.user.name}!` });
      
      // Clear form
      setEmail('');
      setPassword('');
      setName('');
    } catch (error) {
      setMessage({ 
        type: 'error', 
        text: error.response?.data?.error || 'Something went wrong. Please try again.' 
      });
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('convertx_token');
    setToken(null);
    setUser(null);
    setHistory([]);
    setShowPricing(false);
  };

  const handleUpgrade = async () => {
    try {
      setLoading(true);
      const res = await axios.post(
        `${API_URL}/api/payment/create-checkout`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      if (res.data.checkoutUrl) {
        window.location.href = res.data.checkoutUrl;
      }
    } catch (error) {
      setMessage({ 
        type: 'error', 
        text: 'Failed to start checkout. Please try again.' 
      });
    } finally {
      setLoading(false);
    }
  };

  const downloadFile = async (filename) => {
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
      
      setMessage({ type: 'success', text: 'File downloaded successfully!' });
    } catch (error) {
      setMessage({ type: 'error', text: 'Download failed. Please try again.' });
    }
  };

  const deleteFile = async (filename) => {
    try {
      await axios.delete(`${API_URL}/api/convert/delete/${filename}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchHistory();
      setMessage({ type: 'success', text: 'File deleted successfully!' });
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to delete file.' });
    }
  };

  // ═══════════════════════════════════════════════════
  // FILE DROP HANDLER
  // ═══════════════════════════════════════════════════

  const onDrop = useCallback(async (acceptedFiles) => {
    if (acceptedFiles.length === 0) return;

    const file = acceptedFiles[0];
    
    // Check if user has remaining conversions
    if (user && user.remainingConversions <= 0) {
      setMessage({
        type: 'upgrade',
        text: 'You\'ve used all your free conversions! Upgrade to Pro for unlimited access.'
      });
      setShowPricing(true);
      return;
    }

    setConverting(true);
    setMessage(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await axios.post(`${API_URL}/api/convert/to-pdf`, formData, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'multipart/form-data'
        }
      });

      setMessage({ type: 'success', text: '✅ File converted successfully!' });
      fetchUserProfile();
      fetchHistory();

      // Auto-download the converted file
      if (res.data.convertedFileName) {
        setTimeout(() => downloadFile(res.data.convertedFileName), 500);
      }
    } catch (error) {
      if (error.response?.status === 403 && error.response?.data?.needsUpgrade) {
        setMessage({
          type: 'upgrade',
          text: 'You\'ve reached your monthly limit. Upgrade to Pro for unlimited conversions!'
        });
        setShowPricing(true);
      } else {
        setMessage({
          type: 'error',
          text: error.response?.data?.error || '❌ Conversion failed. Please try again.'
        });
      }
    } finally {
      setConverting(false);
    }
  }, [token, user]);

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
  // RENDER: LOGIN/REGISTER PAGE
  // ═══════════════════════════════════════════════════

  if (!token) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-header">
            <div className="app-logo">📄</div>
            <h1 className="app-title">{APP_NAME}</h1>
            <p className="app-subtitle">Convert any file to PDF in seconds</p>
          </div>

          {message && (
            <div className={`message message-${message.type}`}>
              {message.text}
            </div>
          )}

          <form onSubmit={handleAuth} className="auth-form">
            <h2 className="auth-mode-title">
              {authMode === 'login' ? 'Welcome Back' : 'Create Account'}
            </h2>

            {authMode === 'register' && (
              <div className="input-group">
                <label>Name</label>
                <input
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
            )}

            <div className="input-group">
              <label>Email</label>
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="input-group">
              <label>Password</label>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength="6"
              />
            </div>

            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Please wait...' : authMode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <div className="auth-switch">
            {authMode === 'login' ? (
              <p>Don't have an account?{' '}
                <button onClick={() => { setAuthMode('register'); setMessage(null); }}>
                  Sign Up
                </button>
              </p>
            ) : (
              <p>Already have an account?{' '}
                <button onClick={() => { setAuthMode('login'); setMessage(null); }}>
                  Sign In
                </button>
              </p>
            )}
          </div>

          <div className="auth-footer">
            <div className="pricing-preview">
              <span className="free-badge">Free</span>
              <span>{FREE_LIMIT} conversions/month</span>
            </div>
            <div className="pricing-preview">
              <span className="pro-badge">Pro</span>
              <span>Unlimited • ${PRO_PRICE}/month</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════
  // RENDER: MAIN DASHBOARD
  // ═══════════════════════════════════════════════════

  return (
    <div className="app-container">
      {/* Navigation Bar */}
      <nav className="navbar">
        <div className="nav-brand">
          <span className="nav-logo">📄</span>
          <span className="nav-title">{APP_NAME}</span>
        </div>
        
        <div className="nav-user">
          <div className="user-info">
            <span className="user-plan-badge">{user?.plan}</span>
            <span className="user-name">{user?.name}</span>
          </div>
          <div className="conversion-counter">
            <div className="counter-bar">
              <div 
                className="counter-fill"
                style={{ 
                  width: `${(user?.conversionsUsed / user?.maxConversions) * 100}%`,
                  backgroundColor: user?.remainingConversions <= 1 ? '#EF4444' : '#4A90E2'
                }}
              />
            </div>
            <span className="counter-text">
              {user?.conversionsUsed}/{user?.maxConversions} conversions
            </span>
          </div>
          <button onClick={logout} className="btn-logout">Sign Out</button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="main-content">
        <div className="content-grid">
          {/* Left Column - Upload & Convert */}
          <div className="column-main">
            {/* Upgrade Alert */}
            {user?.plan === 'free' && user?.remainingConversions <= 1 && (
              <div className="upgrade-alert">
                <div className="alert-content">
                  <span className="alert-icon">⚡</span>
                  <span>
                    {user?.remainingConversions === 0 
                      ? "You've used all your free conversions!" 
                      : `Only ${user?.remainingConversions} conversion left!`}
                  </span>
                </div>
                <button onClick={() => setShowPricing(true)} className="btn-upgrade-sm">
                  Upgrade to Pro
                </button>
              </div>
            )}

            {/* File Drop Zone */}
            <div className="upload-section">
              <h2 className="section-title">Convert File to PDF</h2>
              
              <div 
                {...getRootProps()} 
                className={`dropzone ${isDragActive ? 'dropzone-active' : ''} ${converting ? 'dropzone-converting' : ''}`}
              >
                <input {...getInputProps()} />
                
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
                    <p className="file-size-limit">Maximum file size: 50MB</p>
                  </div>
                )}
              </div>
            </div>

            {/* Message Display */}
            {message && (
              <div className={`message message-${message.type}`}>
                {message.type === 'upgrade' && (
                  <button onClick={() => setShowPricing(true)} className="btn-upgrade-inline">
                    Upgrade Now - ${PRO_PRICE}/month
                  </button>
                )}
                <span>{message.text}</span>
              </div>
            )}

            {/* Conversion History */}
            <div className="history-section">
              <h2 className="section-title">Recent Conversions</h2>
              
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
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                          {file.file_size && ` • ${(file.file_size / 1024).toFixed(1)} KB`}
                        </p>
                      </div>
                      <div className="file-actions">
                        <button 
                          onClick={() => downloadFile(file.converted_path)}
                          className="btn-icon"
                          title="Download"
                        >
                          ⬇️
                        </button>
                        <button 
                          onClick={() => deleteFile(file.converted_path)}
                          className="btn-icon"
                          title="Delete"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Column - Subscription Info */}
          <div className="column-side">
            {/* Current Plan Card */}
            <div className="plan-card">
              <h3 className="plan-card-title">Your Plan</h3>
              
              <div className="current-plan">
                <span className={`plan-badge plan-${user?.plan}`}>
                  {user?.plan === 'free' ? 'Free Tier' : 'Pro Plan'}
                </span>
                <p className="plan-price">
                  {user?.plan === 'free' ? '$0' : `$${PRO_PRICE}`}<span>/month</span>
                </p>
              </div>

              <div className="plan-features">
                <div className="feature-item">
                  <span className="feature-icon">✓</span>
                  <span>{user?.maxConversions} conversions/month</span>
                </div>
                <div className="feature-item">
                  <span className="feature-icon">✓</span>
                  <span>Files up to 50MB</span>
                </div>
                <div className="feature-item">
                  <span className="feature-icon">✓</span>
                  <span>Multiple formats supported</span>
                </div>
                <div className="feature-item">
                  <span className="feature-icon">
                    {user?.plan === 'pro' ? '✓' : '—'}
                  </span>
                  <span>Priority processing</span>
                </div>
                <div className="feature-item">
                  <span className="feature-icon">
                    {user?.plan === 'pro' ? '✓' : '—'}
                  </span>
                  <span>Advanced formatting</span>
                </div>
              </div>

              {user?.plan === 'free' && (
                <button 
                  onClick={() => setShowPricing(true)} 
                  className="btn-upgrade-full"
                >
                  Upgrade to Pro - ${PRO_PRICE}/month
                </button>
              )}
            </div>

            {/* Why Upgrade Card */}
            {user?.plan === 'free' && (
              <div className="why-upgrade-card">
                <h3>Why Go Pro?</h3>
                <ul>
                  <li>🚀 Unlimited file conversions</li>
                  <li>⚡ Lightning fast processing</li>
                  <li>📊 Better formatting retention</li>
                  <li>🔒 Secure file handling</li>
                  <li>📧 Priority email support</li>
                </ul>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Pricing Modal */}
      {showPricing && (
        <div className="modal-overlay" onClick={() => setShowPricing(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowPricing(false)}>✕</button>
            
            <div className="pricing-header">
              <h2>Upgrade to {APP_NAME} Pro</h2>
              <p>Get unlimited file conversions and premium features</p>
            </div>

            <div className="pricing-grid">
              <div className="pricing-card pricing-free">
                <h3>Free</h3>
                <p className="price">$0</p>
                <p className="price-period">forever</p>
                <ul>
                  <li>✓ {FREE_LIMIT} conversions/month</li>
                  <li>✓ Basic PDF conversion</li>
                  <li>✓ Up to 50MB files</li>
                  <li>✓ Standard processing</li>
                </ul>
                <button className="btn-disabled" disabled>Current Plan</button>
              </div>

              <div className="pricing-card pricing-pro">
                <div className="popular-badge">Most Popular</div>
                <h3>Pro</h3>
                <p className="price">${PRO_PRICE}</p>
                <p className="price-period">per month</p>
                <ul>
                  <li>✓ Unlimited conversions</li>
                  <li>✓ Advanced PDF formatting</li>
                  <li>✓ Up to 50MB files</li>
                  <li>✓ Priority processing</li>
                  <li>✓ Email support</li>
                  <li>✓ No watermarks</li>
                </ul>
                <button 
                  onClick={handleUpgrade} 
                  className="btn-primary"
                  disabled={loading}
                >
                  {loading ? 'Redirecting...' : 'Upgrade Now'}
                </button>
                <p className="secure-note">🔒 Secure payment powered by Paddle</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="footer">
        <p>&copy; 2024 {APP_NAME}. All rights reserved.</p>
        <p className="footer-tagline">Convert any file to PDF, instantly.</p>
      </footer>
    </div>
  );
}

export default App;