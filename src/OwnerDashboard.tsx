import { useState, useEffect, useMemo } from 'react';
import {
  ChevronLeft, Users, Shield, Zap, Search,
  RefreshCw, Clock, Mail, Globe, Check, X, MessageSquare
} from 'lucide-react';

import { API_BASE } from './lib/apiBase';

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
  profileImageUrl: string | null;
  createdAt: string;
  lastIpAddress: string | null;
  canUseAiSolutions: boolean;
  canAccessAiChatRoom: boolean;
  canUseGuestSync: boolean;
  z7iLinked: boolean;
  z7iEnrollment: string | null;
  lastSyncAt: string | null;
  z7iFirstName?: string | null;
}

type IpGeoDetails = {
  ip: string;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  org?: string | null;
  timezone?: string | null;
};

type UserIpLog = {
  ip: string;
  firstSeenAt: string;
  lastSeenAt: string;
};

type UserHistoryItem = {
  id: string;
  actionType: string;
  title: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

type DeletedAccount = {
  id: string;
  email: string;
  name: string | null;
  enrollmentNo: string | null;
  ips: Array<{ ip: string; firstSeenAt?: string; lastSeenAt?: string }> | null;
  deletedAt: string;
};

export function OwnerDashboard({ onBack }: { onBack: () => void }) {
  const [users, setUsers] = useState<UserDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [updatingUser, setUpdatingUser] = useState<string | null>(null);
  const [fetchingAll, setFetchingAll] = useState(false);
  const [outputLog, setOutputLog] = useState<string[]>([]);
  const [showTestList, setShowTestList] = useState(false);
  const [tests, setTests] = useState<any[]>([]);
  const [loadingTests, setLoadingTests] = useState(false);
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const [mapIp, setMapIp] = useState<string | null>(null);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapGeo, setMapGeo] = useState<IpGeoDetails | null>(null);
  const [expGrantUser, setExpGrantUser] = useState<UserDetails | null>(null);
  const [recalculating, setRecalculating] = useState(false);
  const [expGrantAmount, setExpGrantAmount] = useState('');
  const [expGrantNote, setExpGrantNote] = useState('');
  const [expGranting, setExpGranting] = useState(false);

  const appendLog = (line: string) => {
    const ts = new Date().toLocaleTimeString();
    setOutputLog(prev => [...prev, `[${ts}] ${line}`]);
  };
  const [ipHistoryUser, setIpHistoryUser] = useState<UserDetails | null>(null);
  const [ipHistoryLogs, setIpHistoryLogs] = useState<UserIpLog[]>([]);
  const [ipHistoryLoading, setIpHistoryLoading] = useState(false);
  const [ipHistoryError, setIpHistoryError] = useState<string | null>(null);
  const [userHistory, setUserHistory] = useState<UserHistoryItem[]>([]);
  const [deletedAccounts, setDeletedAccounts] = useState<DeletedAccount[]>([]);
  const [deletedAccountsLoading, setDeletedAccountsLoading] = useState(false);

  const [userFilter, setUserFilter] = useState<'all' | 'ai' | 'chatroom' | 'guest' | 'linked' | 'unlinked'>('all');

  const handleFetchAll = async () => {
    setFetchingAll(true);
    appendLog('Syncing all user results...');
    try {
      const data = await apiRequest('/z7i?action=admin-fetch-all', { method: 'POST' });
      if (data.success) {
        appendLog(`Sync complete — ${data.successCount}/${data.total} users synced.`);
        if (data.failedCount > 0) appendLog(`Failed: ${data.failedCount} users.`);
        if (Array.isArray(data.results)) {
          data.results.filter((r: any) => r.error || r.errorDetails).forEach((r: any) => {
            appendLog(`  ERR ${r.enrollmentNo || r.userId}: ${r.error || ''}`);
            if (Array.isArray(r.errorDetails)) r.errorDetails.forEach((ed: string) => appendLog(`    ${ed}`));
          });
        }
      } else {
        appendLog('Sync failed: ' + (data.error || 'Unknown error'));
      }
    } catch (e) {
      appendLog('Network error. Please try again.');
    } finally {
      setFetchingAll(false);
    }
  };

  const handleRecalculateExp = async () => {
    setRecalculating(true);
    appendLog('Recalculating EXP for all users...');
    try {
      const data = await apiRequest('/league?action=recalculate', { method: 'POST' });
      if (data.success) {
        appendLog(`EXP recalculated: ${data.processed}/${data.total} users processed.`);
      } else {
        appendLog('Recalculate failed: ' + (data.error || 'Unknown error'));
      }
    } catch (e) {
      appendLog('Network error. Please try again.');
    } finally {
      setRecalculating(false);
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
    appendLog('Syncing selected test for all users...');
    setShowTestList(false);
    try {
      const data = await apiRequest('/z7i?action=admin-fetch-all', {
        method: 'POST',
        body: JSON.stringify({ testId: selectedTestId })
      });
      if (data.success) {
        appendLog(`Sync complete — ${data.successCount}/${data.total} users synced.`);
        if (data.failedCount > 0) appendLog(`Failed: ${data.failedCount} users.`);
      } else {
        appendLog('Sync failed: ' + (data.error || 'Unknown error'));
      }
    } catch (e) {
      appendLog('Network error. Please try again.');
    } finally {
      setFetchingAll(false);
    }
  };

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

  const loadDeletedAccounts = async () => {
    setDeletedAccountsLoading(true);
    try {
      const data = await apiRequest('/z7i?action=admin-deleted-accounts');
      if (data.success) {
        setDeletedAccounts(data.accounts || []);
      }
    } catch {
    } finally {
      setDeletedAccountsLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
    loadDeletedAccounts();
  }, []);

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

  const toggleGuestSyncPermission = async (userId: string, currentValue: boolean) => {
    setUpdatingUser(userId);

    try {
      const data = await apiRequest('/z7i?action=admin-toggle-guest-sync', {
        method: 'POST',
        body: JSON.stringify({ userId, canUseGuestSync: !currentValue }),
      });

      if (data.success) {
        setUsers(prev => prev.map(u =>
          u.id === userId ? { ...u, canUseGuestSync: !currentValue } : u
        ));
      } else {
        setError(data.error || 'Failed to update guest sync permission');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setUpdatingUser(null);
    }
  };

  const handleOpenMap = async (ip: string) => {
    setMapIp(ip);
    setMapGeo(null);
    setMapError(null);
    setMapLoading(true);

    try {
      const data = await apiRequest(`/z7i?action=admin-ip-geo&ip=${encodeURIComponent(ip)}`);
      if (data?.error) {
        setMapError(data.error || 'Failed to resolve IP location.');
        return;
      }
      setMapGeo({
        ip,
        city: data.city || null,
        region: data.region || null,
        country: data.country || null,
        latitude: typeof data.latitude === 'number' ? data.latitude : null,
        longitude: typeof data.longitude === 'number' ? data.longitude : null,
        org: data.org || null,
        timezone: data.timezone || null,
      });
    } catch {
      setMapError('Failed to resolve IP location.');
    } finally {
      setMapLoading(false);
    }
  };

  const handleGrantExp = async () => {
    if (!expGrantUser) return;
    const expValue = Number(expGrantAmount);
    if (!Number.isFinite(expValue) || expValue === 0) {
      setError('EXP must be a non-zero number.');
      return;
    }

    setExpGranting(true);
    setError('');
    try {
      const data = await apiRequest('/z7i?action=admin-grant-exp', {
        method: 'POST',
        body: JSON.stringify({
          userId: expGrantUser.id,
          exp: expValue,
          note: expGrantNote.trim() || undefined,
        })
      });

      if (data.success) {
        appendLog(`${expValue > 0 ? 'Granted' : 'Removed'} ${Math.abs(Math.round(expValue))} EXP ${expValue > 0 ? 'to' : 'from'} ${expGrantUser.email}.`);
        setExpGrantUser(null);
        setExpGrantAmount('');
        setExpGrantNote('');
      } else {
        setError(data.error || 'Failed to grant EXP.');
      }
    } catch {
      setError('Network error while granting EXP.');
    } finally {
      setExpGranting(false);
    }
  };

  const handleOpenIpHistory = async (user: UserDetails) => {
    setIpHistoryUser(user);
    setIpHistoryLogs([]);
    setUserHistory([]);
    setIpHistoryError(null);
    setIpHistoryLoading(true);
    try {
      const [ipData, historyData] = await Promise.all([
        apiRequest(`/z7i?action=admin-user-ips&userId=${encodeURIComponent(user.id)}`),
        apiRequest(`/z7i?action=admin-user-history&userId=${encodeURIComponent(user.id)}`),
      ]);
      if (ipData.success) {
        setIpHistoryLogs(ipData.logs || []);
      } else {
        setIpHistoryError(ipData.error || 'Failed to load IP logs.');
      }
      if (historyData.success) {
        setUserHistory(historyData.history || []);
      } else {
        setIpHistoryError(historyData.error || 'Failed to load user history.');
      }
    } catch {
      setIpHistoryError('Failed to load user activity.');
    } finally {
      setIpHistoryLoading(false);
    }
  };

  const filteredUsers = users.filter(user => {
    const search = searchTerm.toLowerCase();
    const matchesSearch = (
      user.email.toLowerCase().includes(search) ||
      (user.name?.toLowerCase().includes(search)) ||
      (user.z7iEnrollment?.toLowerCase().includes(search)) ||
      (user.lastIpAddress?.toLowerCase().includes(search))
    );
    if (!matchesSearch) return false;
    if (userFilter === 'ai') return user.canUseAiSolutions;
    if (userFilter === 'chatroom') return user.canAccessAiChatRoom;
    if (userFilter === 'guest') return user.canUseGuestSync;
    if (userFilter === 'linked') return user.z7iLinked;
    if (userFilter === 'unlinked') return !user.z7iLinked;
    return true;
  });

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleString();
  };

  const stats = useMemo(() => {
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    return {
      total: users.length,
      linked: users.filter(u => u.z7iLinked).length,
      aiEnabled: users.filter(u => u.canUseAiSolutions).length,
      chatroom: users.filter(u => u.canAccessAiChatRoom).length,
      guestSync: users.filter(u => u.canUseGuestSync).length,
      recentSyncs: users.filter(u => u.lastSyncAt && now - new Date(u.lastSyncAt).getTime() <= sevenDaysMs).length,
    };
  }, [users]);

  return (
    <div className="page owner-dashboard-page">
      <div className="container">
        <div className="owner-hero">
          <div className="owner-hero-main">
            <button className="btn btn-ghost owner-back" onClick={onBack}>
              <ChevronLeft size={16} />
              Back to Dashboard
            </button>
            <div className="owner-hero-title">
              <span className="owner-hero-icon">
                <Shield size={28} />
              </span>
              <div>
                <h1>Owner Command Center</h1>
                <p>Manage users, permissions, and sync operations • {users.length} total users</p>
              </div>
            </div>
          </div>
          <div className="owner-hero-actions">
            <button className="btn btn-secondary" onClick={loadUsers} disabled={loading}>
              <RefreshCw size={16} className={loading ? 'spin' : ''} />
              Refresh
            </button>
            <button
              className="btn btn-primary"
              onClick={handleFetchAll}
              disabled={fetchingAll}
            >
              <Zap size={16} />
              {fetchingAll ? 'Syncing...' : 'Fetch All Results'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={handleListTests}
              disabled={fetchingAll}
            >
              <Search size={16} />
              Sync Specific Test
            </button>
            <button
              className="btn btn-secondary"
              onClick={handleRecalculateExp}
              disabled={recalculating || fetchingAll}
            >
              <RefreshCw size={16} className={recalculating ? 'spin' : ''} />
              {recalculating ? 'Recalculating...' : 'Recalculate EXP'}
            </button>
          </div>
        </div>

        {showTestList && (
          <div className="modal-overlay">
            <div className="modal" style={{ maxWidth: 520 }}>
              <h2 style={{ marginBottom: 16 }}>Select a Test to Sync</h2>
              {loadingTests ? (
                <div style={{ textAlign: 'center', padding: '2rem' }}>
                  <span className="spinner" />
                </div>
              ) : (
                <>
                  <div style={{ maxHeight: 320, overflowY: 'auto', marginBottom: 16 }}>
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
        {error && (
          <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        <div className="owner-stats-grid">
          {[
            { label: 'Total Users', value: stats.total, icon: <Users size={20} /> },
            { label: 'Z7I Linked', value: stats.linked, icon: <Shield size={20} /> },
            { label: 'AI Enabled', value: stats.aiEnabled, icon: <Zap size={20} /> },
            { label: 'Chatroom Access', value: stats.chatroom, icon: <MessageSquare size={20} /> },
            { label: 'Guest Sync', value: stats.guestSync, icon: <RefreshCw size={20} /> },
            { label: 'Active (7d)', value: stats.recentSyncs, icon: <Clock size={20} /> },
          ].map((item, index) => (
            <div key={item.label} className="owner-stat-card" style={{ ['--i' as any]: index }}>
              <div className="owner-stat-icon">{item.icon}</div>
              <div>
                <div className="owner-stat-value">{item.value}</div>
                <div className="owner-stat-label">{item.label}</div>
              </div>
            </div>
          ))}
        </div>



        <div className="owner-management">
          <div className="owner-management-header">
            <div>
              <h2>User Command</h2>
              <p>Search, filter, and manage permissions with single-click actions.</p>
            </div>
            <div className="owner-management-controls">
              <div className="owner-filter">
                <label className="form-label">Filter</label>
                <select
                  className="form-input"
                  value={userFilter}
                  onChange={(e) => setUserFilter(e.target.value as typeof userFilter)}
                >
                  <option value="all">All users</option>
                  <option value="linked">Z7I linked</option>
                  <option value="unlinked">Not linked</option>
                  <option value="ai">AI enabled</option>
                  <option value="chatroom">Chatroom access</option>
                  <option value="guest">Guest sync</option>
                </select>
              </div>
              <div className="search-box owner-search">
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
          </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
            <span className="spinner" />
          </div>
        ) : (
          <div className="owner-table-card">
            <div className="owner-table-scroll">
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
                    <th style={thStyle}>Guest Sync</th>
                    <th style={thStyle}>AI Chatroom</th>
                    <th style={thStyle}>EXP</th>
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
                          {user.profileImageUrl ? (
                            <img
                              src={user.profileImageUrl}
                              alt={user.name || user.email}
                              style={{
                                width: '36px',
                                height: '36px',
                                borderRadius: '50%',
                                objectFit: 'cover',
                                border: '1px solid var(--border)'
                              }}
                            />
                          ) : (
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
                          )}
                          <div>
                            <button
                              type="button"
                              className="owner-user-name"
                              onClick={() => handleOpenIpHistory(user)}
                            >
                              {user.name || 'No name'}
                            </button>
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
                              onClick={() => handleOpenMap(user.lastIpAddress!)}
                              title="View location"
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
                          className={`btn ${user.canUseGuestSync ? 'btn-success' : 'btn-secondary'}`}
                          onClick={() => toggleGuestSyncPermission(user.id, user.canUseGuestSync)}
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
                          ) : user.canUseGuestSync ? (
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
                      <td style={tdStyle}>
                        <button
                          className="btn btn-secondary"
                          onClick={() => {
                            setExpGrantUser(user);
                            setExpGrantAmount('');
                            setExpGrantNote('');
                          }}
                          style={{ minWidth: '120px' }}
                        >
                          <Zap size={14} />
                          Grant
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
                <p>Location preview for {mapIp}</p>
              </div>
              <button className="btn btn-secondary btn-small" onClick={() => setMapIp(null)}>
                Close
              </button>
            </div>
            {mapLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
                <span className="spinner" />
              </div>
            ) : mapError ? (
              <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
                {mapError}
              </div>
            ) : (
              <div className="map-modal-info">
                <div>
                  <strong>{mapGeo?.city || 'Unknown city'}</strong>
                  <span>{[mapGeo?.region, mapGeo?.country].filter(Boolean).join(', ') || 'Unknown region'}</span>
                </div>
                <div>
                  <span>{mapGeo?.org || 'Unknown network'}</span>
                  <span>{mapGeo?.timezone || 'Unknown timezone'}</span>
                </div>
              </div>
            )}
            <div className="map-modal-frame">
              {mapGeo && mapGeo.latitude !== null && mapGeo.longitude !== null ? (
                <iframe
                  title={`Map for ${mapIp}`}
                  src={`https://www.openstreetmap.org/export/embed.html?bbox=${mapGeo.longitude - 0.1}%2C${mapGeo.latitude - 0.1}%2C${mapGeo.longitude + 0.1}%2C${mapGeo.latitude + 0.1}&layer=mapnik&marker=${mapGeo.latitude}%2C${mapGeo.longitude}`}
                  loading="lazy"
                />
              ) : (
                <div className="map-modal-fallback">
                  No coordinates available for this IP.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {expGrantUser && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 420 }}>
            <div className="map-modal-header">
              <div>
                <h2>Grant EXP</h2>
                <p>{expGrantUser.email}</p>
              </div>
              <button className="btn btn-secondary btn-small" onClick={() => setExpGrantUser(null)}>
                Close
              </button>
            </div>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <div>
                <label className="form-label">EXP amount</label>
                <input
                  className="form-input"
                  type="number"
                  value={expGrantAmount}
                  onChange={(e) => setExpGrantAmount(e.target.value)}
                  placeholder="e.g., 250 or -100"
                />
              </div>
              <div>
                <label className="form-label">Note (optional)</label>
                <input
                  className="form-input"
                  value={expGrantNote}
                  onChange={(e) => setExpGrantNote(e.target.value)}
                  placeholder="Reason for grant"
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button className="btn btn-secondary" onClick={() => setExpGrantUser(null)}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={handleGrantExp} disabled={expGranting}>
                  {expGranting ? 'Granting...' : 'Grant EXP'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {ipHistoryUser && (
        <div className="modal-overlay">
          <div className="modal owner-ip-modal">
            <div className="map-modal-header">
              <div>
                <h2>User activity</h2>
                <p>{ipHistoryUser.name || ipHistoryUser.email}</p>
              </div>
              <button className="btn btn-secondary btn-small" onClick={() => setIpHistoryUser(null)}>
                Close
              </button>
            </div>
            {ipHistoryLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
                <span className="spinner" />
              </div>
            ) : ipHistoryError ? (
              <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
                {ipHistoryError}
              </div>
            ) : ipHistoryLogs.length === 0 ? (
              <div className="owner-ip-empty">No IP logs yet.</div>
            ) : (
              <div className="owner-ip-list">
                {ipHistoryLogs.map((log) => (
                  <div key={log.ip} className="owner-ip-row">
                    <div className="owner-ip-value">{log.ip}</div>
                    <div className="owner-ip-meta">
                      <span>First: {formatDate(log.firstSeenAt)}</span>
                      <span>Last: {formatDate(log.lastSeenAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: '1rem' }}>
              <h3 style={{ marginBottom: '0.5rem', fontSize: '0.95rem' }}>Recent actions</h3>
              {userHistory.length === 0 ? (
                <div className="owner-ip-empty">No recorded actions yet.</div>
              ) : (
                <div className="owner-ip-list">
                  {userHistory.map((item) => (
                    <div key={item.id} className="owner-ip-row">
                      <div className="owner-ip-value">{item.title}</div>
                      <div className="owner-ip-meta">
                        <span>{item.description || item.actionType}</span>
                        <span>{formatDate(item.createdAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="owner-outputs-section">
        <div className="owner-outputs-header">
          <h2>Outputs</h2>
          {outputLog.length > 0 && (
            <button className="btn btn-secondary btn-small" onClick={() => setOutputLog([])}>
              Clear
            </button>
          )}
        </div>
        <div className="owner-outputs-terminal">
          {outputLog.length === 0 ? (
            <span className="owner-outputs-empty">No output yet. Run syncs or actions to see logs here.</span>
          ) : (
            outputLog.map((line, i) => <div key={i} className="owner-outputs-line">{line}</div>)
          )}
        </div>
      </div>

      <div className="owner-deleted-section">
        <div className="owner-deleted-header">
          <div>
            <h2>Deleted accounts</h2>
            <p>Accounts removed by users, along with saved identity details.</p>
          </div>
          <button className="btn btn-secondary" onClick={loadDeletedAccounts} disabled={deletedAccountsLoading}>
            <RefreshCw size={16} className={deletedAccountsLoading ? 'spin' : ''} /> Refresh
          </button>
        </div>

        {deletedAccountsLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
            <span className="spinner" />
          </div>
        ) : deletedAccounts.length === 0 ? (
          <div className="owner-deleted-empty">No deleted accounts logged yet.</div>
        ) : (
          <div className="owner-deleted-grid">
            {deletedAccounts.map((account) => (
              <div key={account.id} className="owner-deleted-card">
                <div className="owner-deleted-top">
                  <div>
                    <strong>{account.name || 'Unknown name'}</strong>
                    <span>{account.email}</span>
                  </div>
                  <div className="owner-deleted-date">{formatDate(account.deletedAt)}</div>
                </div>
                <div className="owner-deleted-meta">
                  <span>Enrollment: {account.enrollmentNo || 'N/A'}</span>
                </div>
                <div className="owner-deleted-ips">
                  {(account.ips || []).length > 0 ? (
                    (account.ips || []).map((ipEntry) => (
                      <div key={ipEntry.ip} className="owner-ip-chip">
                        <span>{ipEntry.ip}</span>
                        <small>
                          {ipEntry.lastSeenAt ? `Last ${formatDate(ipEntry.lastSeenAt)}` : 'Last seen unknown'}
                        </small>
                      </div>
                    ))
                  ) : (
                    <span className="owner-deleted-empty">No IPs logged.</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
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
