import { useState, useEffect } from 'react';
import {
  ChevronLeft, Users, Shield, Zap, Search,
  RefreshCw, Clock, Mail, Globe, Check, X
} from 'lucide-react';
import './index.css';

const API_BASE = import.meta.env.PROD ? '/api' : 'http://localhost:3000/api';

async function apiRequest(endpoint: string, options: RequestInit = {}) {
  const token = localStorage.getItem('token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });
  
  return res.json();
}

interface UserDetails {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  lastIpAddress: string | null;
  canUseAiSolutions: boolean;
  canAccessAiChatRoom: boolean;
  z7iLinked: boolean;
  z7iEnrollment: string | null;
  lastSyncAt: string | null;
  z7iFirstName?: string | null;
}

export function OwnerDashboard({ onBack }: { onBack: () => void }) {
  const [users, setUsers] = useState<UserDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [updatingUser, setUpdatingUser] = useState<string | null>(null);
  const [fetchingAll, setFetchingAll] = useState(false);
  const [fetchAllStatus, setFetchAllStatus] = useState<string | null>(null);
  const [fetchAllResult, setFetchAllResult] = useState<any>(null);
  const [showTestList, setShowTestList] = useState(false);
  const [tests, setTests] = useState<any[]>([]);
  const [loadingTests, setLoadingTests] = useState(false);
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const [mapIp, setMapIp] = useState<string | null>(null);

  const upgradeRecommendations = [
    {
      title: 'Premium Analytics Pack',
      description: 'Deep cohort trends, accuracy heatmaps, and chapter-wise weak area tracking.',
    },
    {
      title: 'Proctoring + Integrity',
      description: 'Browser tab tracking, device fingerprinting, and attempt anomaly alerts.',
    },
    {
      title: 'Mentor Insights',
      description: 'Automated feedback summaries for each student with action items.',
    },
    {
      title: 'Priority Support SLA',
      description: 'Faster response time, dedicated escalation channel, and uptime reports.',
    },
  ];

  const handleFetchAll = async () => {
    setFetchingAll(true);
    setFetchAllStatus('Syncing all user results...');
    setFetchAllResult(null);
    try {
      const data = await apiRequest('/z7i?action=admin-fetch-all', { method: 'POST' });
      if (data.success) {
        setFetchAllStatus('Sync complete!');
        setFetchAllResult(data);
      } else {
        setFetchAllStatus('Sync failed: ' + (data.error || 'Unknown error'));
      }
    } catch (e) {
      setFetchAllStatus('Network error. Please try again.');
    } finally {
      setFetchingAll(false);
    }
  };

  const handleListTests = async () => {
    setShowTestList(true);
    setLoadingTests(true);
    setTests([]);
    try {
      const data = await apiRequest('/z7i?action=admin-list-tests');
      if (data.success) {
        setTests(data.tests);
      }
    } catch {
    } finally {
      setLoadingTests(false);
    }
  };

  const handleSyncSelectedTest = async () => {
    if (!selectedTestId) return;
    setFetchingAll(true);
    setFetchAllStatus('Syncing selected test for all users...');
    setFetchAllResult(null);
    setShowTestList(false);
    try {
      const data = await apiRequest('/z7i?action=admin-fetch-all', {
        method: 'POST',
        body: JSON.stringify({ testId: selectedTestId })
      });
      if (data.success) {
        setFetchAllStatus('Sync complete!');
        setFetchAllResult(data);
      } else {
        setFetchAllStatus('Sync failed: ' + (data.error || 'Unknown error'));
      }
    } catch (e) {
      setFetchAllStatus('Network error. Please try again.');
    } finally {
      setFetchingAll(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setLoading(true);
    setError('');

    try {
      const data = await apiRequest('/z7i?action=admin-users');

      if (data.success) {
        setUsers(data.users);
      } else {
        setError(data.error || 'Failed to load users');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const toggleAiPermission = async (userId: string, currentValue: boolean) => {
    setUpdatingUser(userId);
    
    try {
      const data = await apiRequest('/z7i?action=admin-toggle-ai', {
        method: 'POST',
        body: JSON.stringify({ userId, canUseAiSolutions: !currentValue }),
      });

      if (data.success) {
        setUsers(prev => prev.map(u => 
          u.id === userId ? { ...u, canUseAiSolutions: !currentValue } : u
        ));
      } else {
        setError(data.error || 'Failed to update permission');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setUpdatingUser(null);
    }
  };

  const toggleAiChatRoomPermission = async (userId: string, currentValue: boolean) => {
    setUpdatingUser(userId);

    try {
      const data = await apiRequest('/z7i?action=admin-toggle-ai-chatroom', {
        method: 'POST',
        body: JSON.stringify({ userId, canAccessAiChatRoom: !currentValue }),
      });

      if (data.success) {
        setUsers(prev => prev.map(u =>
          u.id === userId ? { ...u, canAccessAiChatRoom: !currentValue } : u
        ));
      } else {
        setError(data.error || 'Failed to update chatroom permission');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setUpdatingUser(null);
    }
  };

  const filteredUsers = users.filter(user => {
    const search = searchTerm.toLowerCase();
    return (
      user.email.toLowerCase().includes(search) ||
      (user.name?.toLowerCase().includes(search)) ||
      (user.z7iEnrollment?.toLowerCase().includes(search)) ||
      (user.lastIpAddress?.toLowerCase().includes(search))
    );
  });

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleString();
  };

  return (
    <div className="page">
      <div className="container">
        <div className="page-header">
          <div className="page-header-content">
            <button className="btn btn-ghost" onClick={onBack} style={{ marginBottom: '0.5rem' }}>
              <ChevronLeft size={16} />
              Back to Dashboard
            </button>
            <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Shield size={28} />
              Owner Dashboard
            </h1>
            <p className="page-subtitle">
              Manage users and permissions • {users.length} total users
            </p>
          </div>
          <div className="page-header-actions" style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-secondary" onClick={loadUsers} disabled={loading}>
              <RefreshCw size={16} className={loading ? 'spin' : ''} />
              Refresh
            </button>
            <button
              className="btn btn-primary"
              style={{ minWidth: 160, display: 'flex', alignItems: 'center', gap: 8, background: 'var(--primary)', color: 'var(--on-primary)' }}
              onClick={handleFetchAll}
              disabled={fetchingAll}
            >
              <Zap size={16} style={{ color: 'var(--on-primary)' }} />
              {fetchingAll ? 'Syncing...' : 'Fetch All Results'}
            </button>
            <button
              className="btn btn-outline"
              style={{ minWidth: 160, display: 'flex', alignItems: 'center', gap: 8 }}
              onClick={handleListTests}
              disabled={fetchingAll}
            >
              <Search size={16} />
              List & Sync Specific Test
            </button>
          </div>
                {showTestList && (
                  <div className="modal-overlay">
                    <div className="modal" style={{ maxWidth: 480 }}>
                      <h2 style={{ marginBottom: 16 }}>Select a Test to Sync</h2>
                      {loadingTests ? (
                        <div style={{ textAlign: 'center', padding: '2rem' }}>
                          <span className="spinner" />
                        </div>
                      ) : (
                        <>
                          <div style={{ maxHeight: 300, overflowY: 'auto', marginBottom: 16 }}>
                            <table style={{ width: '100%' }}>
                              <thead>
                                <tr>
                                  <th style={{ textAlign: 'left', fontSize: '0.85em', color: 'var(--text-muted)' }}>Test Name</th>
                                  <th style={{ textAlign: 'left', fontSize: '0.85em', color: 'var(--text-muted)' }}>Package</th>
                                  <th style={{ textAlign: 'left', fontSize: '0.85em', color: 'var(--text-muted)' }}>Questions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {tests.map(test => (
                                  <tr key={test.id} style={{ cursor: 'pointer', background: selectedTestId === test.id ? 'var(--card-hover)' : undefined }} onClick={() => setSelectedTestId(test.id)}>
                                    <td>{test.name}</td>
                                    <td>{test.packageName}</td>
                                    <td>{test.totalQuestions}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                            <button className="btn btn-secondary" onClick={() => setShowTestList(false)}>
                              Cancel
                            </button>
                            <button
                              className="btn btn-primary"
                              disabled={!selectedTestId}
                              onClick={handleSyncSelectedTest}
                            >
                              Sync Selected Test
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
        </div>
        {fetchAllStatus && (
          <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
            {fetchAllStatus}
            {fetchAllResult && (
              <div style={{ fontSize: '0.95em', marginTop: 8 }}>
                Synced: {fetchAllResult.successCount} / {fetchAllResult.total} users
                {fetchAllResult.failedCount > 0 && (
                  <span style={{ color: 'var(--danger)', marginLeft: 8 }}>
                    Failed: {fetchAllResult.failedCount}
                  </span>
                )}
                {Array.isArray(fetchAllResult.results) && fetchAllResult.results.filter((r: any) => r.error || r.errorDetails).length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <strong>Errors:</strong>
                    <ul style={{ fontSize: '0.92em', marginTop: 4 }}>
                      {fetchAllResult.results.filter((r: any) => r.error || r.errorDetails).map((r: any, idx: number) => (
                        <li key={r.userId || idx} style={{ color: 'var(--danger)' }}>
                          <span style={{ fontWeight: 500 }}>{r.enrollmentNo || r.userId}:</span> {r.error ? r.error : ''}
                          {Array.isArray(r.errorDetails) && r.errorDetails.length > 0 && (
                            <ul style={{ marginTop: 2, marginBottom: 2 }}>
                              {r.errorDetails.map((ed: string, i: number) => (
                                <li key={i}>{ed}</li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {error && (
          <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        <div style={{ marginBottom: '1.5rem' }}>
          <div className="search-box">
            <Search size={16} style={{ color: 'var(--text-muted)' }} />
            <input
              type="text"
              className="search-input"
              placeholder="Search by email, name, enrollment, or IP..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ flex: 1 }}
            />
          </div>
        </div>

        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
          gap: '1rem',
          marginBottom: '1.5rem'
        }}>
          <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
            <Users size={24} style={{ color: 'var(--primary)', marginBottom: '0.5rem' }} />
            <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{users.length}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Total Users</div>
          </div>
          <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
            <Shield size={24} style={{ color: 'var(--success)', marginBottom: '0.5rem' }} />
            <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>
              {users.filter(u => u.z7iLinked).length}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Z7I Linked</div>
          </div>
          <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
            <Zap size={24} style={{ color: 'var(--warning)', marginBottom: '0.5rem' }} />
            <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>
              {users.filter(u => u.canUseAiSolutions).length}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>AI Enabled</div>
          </div>
        </div>

        <div className="owner-upgrades">
          <div className="owner-upgrades-header">
            <h2>Recommended upgrades</h2>
            <p>Boost retention, oversight, and premium outcomes with focused add-ons.</p>
          </div>
          <div className="owner-upgrades-grid">
            {upgradeRecommendations.map((upgrade) => (
              <div key={upgrade.title} className="owner-upgrade-card">
                <h3>{upgrade.title}</h3>
                <p>{upgrade.description}</p>
              </div>
            ))}
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
            <span className="spinner" />
          </div>
        ) : (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ 
                    borderBottom: '1px solid var(--border)', 
                    background: 'var(--card-hover)' 
                  }}>
                    <th style={thStyle}>User</th>
                    <th style={thStyle}>Z7I Account</th>
                    <th style={thStyle}>Last IP</th>
                    <th style={thStyle}>Joined</th>
                    <th style={thStyle}>AI Solutions</th>
                    <th style={thStyle}>AI Chatroom</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map(user => (
                    <tr 
                      key={user.id} 
                      style={{ borderBottom: '1px solid var(--border)' }}
                    >
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <div style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '50%',
                            background: 'var(--primary)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'white',
                            fontWeight: 600,
                            fontSize: '0.875rem'
                          }}>
                            {(user.name || user.email)[0].toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontWeight: 500 }}>
                              {user.name || 'No name'}
                            </div>
                            <div style={{ 
                              fontSize: '0.75rem', 
                              color: 'var(--text-muted)',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.25rem'
                            }}>
                              <Mail size={12} />
                              {user.email}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td style={tdStyle}>
                        {user.z7iLinked ? (
                          <div>
                            <div style={{ 
                              display: 'flex', 
                              alignItems: 'center', 
                              gap: '0.25rem',
                              color: 'var(--success)',
                              fontWeight: 500
                            }}>
                              <Check size={14} />
                              {user.z7iEnrollment}
                              {user.z7iFirstName && (
                                <span style={{ color: 'var(--primary)', marginLeft: 8, fontWeight: 400, fontSize: '0.85em' }}>
                                  • {user.z7iFirstName}
                                </span>
                              )}
                            </div>
                            <div style={{ 
                              fontSize: '0.75rem', 
                              color: 'var(--text-muted)',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.25rem'
                            }}>
                              <Clock size={12} />
                              Last sync: {formatDate(user.lastSyncAt)}
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>Not linked</span>
                        )}
                      </td>
                      <td style={tdStyle}>
                        {user.lastIpAddress ? (
                          <div style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '0.25rem',
                            fontFamily: 'monospace',
                            fontSize: '0.875rem'
                          }}>
                            <Globe size={14} style={{ color: 'var(--text-muted)' }} />
                            <button
                              type="button"
                              className="ip-map-link"
                              onClick={() => setMapIp(user.lastIpAddress)}
                              title="View location in Google Maps"
                            >
                              {user.lastIpAddress}
                            </button>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>Unknown</span>
                        )}
                      </td>
                      <td style={tdStyle}>
                        <div style={{ fontSize: '0.875rem' }}>
                          {formatDate(user.createdAt)}
                        </div>
                      </td>
                      <td style={tdStyle}>
                        <button
                          className={`btn ${user.canUseAiSolutions ? 'btn-success' : 'btn-secondary'}`}
                          onClick={() => toggleAiPermission(user.id, user.canUseAiSolutions)}
                          disabled={updatingUser === user.id}
                          style={{ 
                            minWidth: '120px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.5rem'
                          }}
                        >
                          {updatingUser === user.id ? (
                            <span className="spinner" style={{ width: '16px', height: '16px' }} />
                          ) : user.canUseAiSolutions ? (
                            <>
                              <Check size={14} />
                              Enabled
                            </>
                          ) : (
                            <>
                              <X size={14} />
                              Disabled
                            </>
                          )}
                        </button>
                      </td>
                      <td style={tdStyle}>
                        <button
                          className={`btn ${user.canAccessAiChatRoom ? 'btn-success' : 'btn-secondary'}`}
                          onClick={() => toggleAiChatRoomPermission(user.id, user.canAccessAiChatRoom)}
                          disabled={updatingUser === user.id || !user.canUseAiSolutions}
                          style={{
                            minWidth: '120px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.5rem',
                            opacity: user.canUseAiSolutions ? 1 : 0.6,
                          }}
                          title={
                            user.canUseAiSolutions
                              ? 'Toggle chatroom access'
                              : 'Enable AI solutions to allow chatroom access'
                          }
                        >
                          {updatingUser === user.id ? (
                            <span className="spinner" style={{ width: '16px', height: '16px' }} />
                          ) : user.canAccessAiChatRoom ? (
                            <>
                              <Check size={14} />
                              Enabled
                            </>
                          ) : (
                            <>
                              <X size={14} />
                              Disabled
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              
              {filteredUsers.length === 0 && (
                <div style={{ 
                  padding: '3rem', 
                  textAlign: 'center', 
                  color: 'var(--text-muted)' 
                }}>
                  {searchTerm ? 'No users match your search' : 'No users found'}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {mapIp && (
        <div className="modal-overlay">
          <div className="modal map-modal">
            <div className="map-modal-header">
              <div>
                <h2>IP location</h2>
                <p>Google Maps preview for {mapIp}</p>
              </div>
              <button className="btn btn-secondary btn-small" onClick={() => setMapIp(null)}>
                Close
              </button>
            </div>
            <div className="map-modal-frame">
              <iframe
                title={`Map for ${mapIp}`}
                src={`https://maps.google.com/maps?q=${encodeURIComponent(mapIp)}&z=11&output=embed`}
                loading="lazy"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.75rem 1rem',
  fontWeight: 600,
  fontSize: '0.75rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--text-muted)'
};

const tdStyle: React.CSSProperties = {
  padding: '0.75rem 1rem',
  verticalAlign: 'middle'
};

export default OwnerDashboard;
