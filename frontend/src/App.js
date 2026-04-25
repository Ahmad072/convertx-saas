import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';

const API_URL = 'https://convertx-saas.onrender.com/'; // CHANGE THIS!
const APP_NAME = 'ConvertX';

function App() {
  const [file, setFile] = useState(null);
  const [converting, setConverting] = useState(false);
  const [message, setMessage] = useState('');
  const [step, setStep] = useState('upload'); // upload | email | otp | download
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [token, setToken] = useState(localStorage.getItem('convertx_token'));
  const [user, setUser] = useState(null);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const otpRefs = useRef([]);

  useEffect(() => {
    if (token) {
      fetchProfile();
    }
  }, [token]);

  const fetchProfile = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/user/profile`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setUser(res.data);
    } catch (error) {
      logout();
    }
  };

  const logout = () => {
    localStorage.removeItem('convertx_token');
    setToken(null);
    setUser(null);
    setStep('upload');
  };

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    setMessage('');
    setStep('upload');
    setDownloadUrl(null);
  };

  const handleConvert = async () => {
    if (!file) return;
    setConverting(true);
    setMessage('Converting...');
    
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await axios.post(`${API_URL}/api/convert`, formData);
      
      if (res.data.success) {
        setDownloadUrl(`${API_URL}/api/download/${res.data.convertedFileName}`);
        setMessage('File converted! Sign in to download.');
        
        if (token && user) {
          setStep('download');
        } else {
          setStep('email');
        }
      }
    } catch (error) {
      setMessage('Conversion failed. Please try again.');
    } finally {
      setConverting(false);
    }
  };

  const handleSendOTP = async () => {
    if (!email.includes('@')) {
      setMessage('Please enter a valid email');
      return;
    }
    setLoading(true);
    try {
      await axios.post(`${API_URL}/api/auth/send-otp`, { email });
      setMessage(`Verification code sent to ${email}`);
      setStep('otp');
      setTimeout(() => otpRefs.current[0]?.focus(), 300);
    } catch (error) {
      setMessage('Failed to send code. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (index, value) => {
    if (value.length > 1) return;
    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);
    if (value && index < 5) otpRefs.current[index + 1]?.focus();
  };

  const handleVerifyOTP = async () => {
    const otpString = otp.join('');
    if (otpString.length !== 6) {
      setMessage('Please enter the 6-digit code');
      return;
    }
    setLoading(true);
    try {
      const res = await axios.post(`${API_URL}/api/auth/verify-otp`, { email, otp: otpString });
      localStorage.setItem('convertx_token', res.data.token);
      setToken(res.data.token);
      setUser(res.data.user);
      setMessage('✅ Verified! Click download.');
      setStep('download');
      setOtp(['', '', '', '', '', '']);
    } catch (error) {
      setMessage(error.response?.data?.error || 'Invalid code');
      setOtp(['', '', '', '', '', '']);
      otpRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '650px', margin: '30px auto', padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '30px' }}>
        <h1 style={{ color: '#4A90E2', fontSize: '32px', margin: 0 }}>📄 {APP_NAME}</h1>
        <p style={{ color: '#666' }}>Convert files to PDF - Free</p>
        {user && (
          <div style={{ background: '#EBF3FC', padding: '10px', borderRadius: '8px', marginTop: '10px' }}>
            <span style={{ fontSize: '14px' }}>👤 {user.email}</span>
            <span style={{ marginLeft: '15px', fontSize: '13px', color: '#666' }}>
              {user.remaining || 20} / {user.dailyLimit || 20} files today
            </span>
            <button onClick={logout} style={{ marginLeft: '15px', cursor: 'pointer', background: 'none', border: 'none', color: '#EF4444', fontSize: '13px' }}>
              Sign Out
            </button>
          </div>
        )}
      </div>

      {/* Upload Area */}
      {step === 'upload' && (
        <div style={{ border: '2px dashed #D1D5DB', borderRadius: '12px', padding: '40px', textAlign: 'center', background: '#F9FAFB', marginBottom: '20px' }}>
          <div style={{ fontSize: '48px', marginBottom: '15px' }}>📁</div>
          <input type="file" onChange={handleFileChange} style={{ marginBottom: '15px' }} />
          <br />
          <button onClick={handleConvert} disabled={converting || !file}
            style={{ padding: '14px 40px', background: converting || !file ? '#D1D5DB' : '#4A90E2', color: 'white', border: 'none', borderRadius: '8px', fontSize: '18px', fontWeight: '600', cursor: converting || !file ? 'not-allowed' : 'pointer' }}>
            {converting ? '⏳ Converting...' : '🔄 Convert to PDF'}
          </button>
          {file && <p style={{ marginTop: '10px', color: '#666' }}>{file.name}</p>}
        </div>
      )}

      {/* Email Step */}
      {step === 'email' && (
        <div style={{ background: 'white', padding: '30px', borderRadius: '12px', boxShadow: '0 2px 10px rgba(0,0,0,0.1)', textAlign: 'center' }}>
          <h2>📧 Verify Email to Download</h2>
          <p style={{ color: '#666' }}>Enter your email to receive a verification code</p>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
            style={{ width: '100%', padding: '12px', border: '2px solid #D1D5DB', borderRadius: '8px', fontSize: '16px', marginBottom: '15px' }} />
          <button onClick={handleSendOTP} disabled={loading}
            style={{ padding: '14px 40px', background: '#4A90E2', color: 'white', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: '600', cursor: 'pointer' }}>
            {loading ? 'Sending...' : 'Send Verification Code'}
          </button>
          <button onClick={() => setStep('upload')} style={{ display: 'block', margin: '10px auto 0', background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}>
            ← Back
          </button>
        </div>
      )}

      {/* OTP Step */}
      {step === 'otp' && (
        <div style={{ background: 'white', padding: '30px', borderRadius: '12px', boxShadow: '0 2px 10px rgba(0,0,0,0.1)', textAlign: 'center' }}>
          <h2>🔢 Enter Verification Code</h2>
          <p style={{ color: '#666' }}>6-digit code sent to <strong>{email}</strong></p>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', margin: '25px 0' }}>
            {otp.map((digit, i) => (
              <input key={i} ref={el => otpRefs.current[i] = el} type="text" maxLength="1" value={digit}
                onChange={(e) => handleOtpChange(i, e.target.value)}
                style={{ width: '45px', height: '55px', border: '2px solid #D1D5DB', borderRadius: '8px', fontSize: '24px', textAlign: 'center', fontWeight: '700' }} />
            ))}
          </div>
          <button onClick={handleVerifyOTP} disabled={loading}
            style={{ padding: '14px 40px', background: '#10B981', color: 'white', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: '600', cursor: 'pointer' }}>
            {loading ? 'Verifying...' : 'Verify & Download'}
          </button>
          <button onClick={() => { setStep('email'); setOtp(['', '', '', '', '', '']); }} style={{ display: 'block', margin: '10px auto 0', background: 'none', border: 'none', color: '#4A90E2', cursor: 'pointer' }}>
            Resend Code
          </button>
        </div>
      )}

      {/* Download Step */}
      {step === 'download' && downloadUrl && (
        <div style={{ background: 'white', padding: '30px', borderRadius: '12px', boxShadow: '0 2px 10px rgba(0,0,0,0.1)', textAlign: 'center' }}>
          <div style={{ fontSize: '48px' }}>✅</div>
          <h2>Ready to Download!</h2>
          <p style={{ color: '#666' }}>Your file has been converted to PDF</p>
          <a href={downloadUrl} download
            style={{ display: 'inline-block', padding: '14px 40px', background: '#10B981', color: 'white', textDecoration: 'none', borderRadius: '8px', fontSize: '18px', fontWeight: '600', marginTop: '15px' }}>
            ⬇️ Download PDF
          </a>
          <br />
          <button onClick={() => { setStep('upload'); setFile(null); }} style={{ marginTop: '15px', background: 'none', border: 'none', color: '#4A90E2', cursor: 'pointer', fontSize: '14px' }}>
            Convert Another File
          </button>
        </div>
      )}

      {/* Messages */}
      {message && (
        <div style={{ padding: '15px', borderRadius: '8px', textAlign: 'center', marginTop: '15px', background: message.includes('✅') ? '#D1FAE5' : message.includes('failed') ? '#FEE2E2' : '#EBF3FC', color: message.includes('failed') ? '#991B1B' : '#065F46' }}>
          {message}
        </div>
      )}
    </div>
  );
}

export default App;
