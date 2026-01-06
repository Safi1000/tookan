import { useState, useEffect } from 'react';
import { Sun, Moon, Wallet, Calendar, FileText, Mail, Shield, Archive, Key, Tag, Plus, Trash2, Save } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { getTagConfig, updateTagConfig, suggestTags, type TagConfig } from '../services/tookanApi';
import { toast } from 'sonner';

export function SettingsPanel() {
  const { theme, toggleTheme } = useTheme();
  const [showCODSection, setShowCODSection] = useState(() => {
    const saved = localStorage.getItem('showCODSection');
    return saved !== null ? saved === 'true' : false;
  });
  const [showDriverWalletSection, setShowDriverWalletSection] = useState(() => {
    const saved = localStorage.getItem('showDriverWalletSection');
    return saved !== null ? saved === 'true' : true;
  });
  const [showCustomerWalletSection, setShowCustomerWalletSection] = useState(() => {
    const saved = localStorage.getItem('showCustomerWalletSection');
    return saved !== null ? saved === 'true' : true;
  });

  // Date & Time Format Settings
  const [dateFormat, setDateFormat] = useState(() => {
    return localStorage.getItem('dateFormat') || 'DD/MM/YYYY';
  });
  const [timeFormat, setTimeFormat] = useState(() => {
    return localStorage.getItem('timeFormat') || '24h';
  });
  const [timezone, setTimezone] = useState(() => {
    return localStorage.getItem('timezone') || 'Asia/Bahrain';
  });

  // Export/Report Defaults
  const [defaultExportFormat, setDefaultExportFormat] = useState(() => {
    return localStorage.getItem('defaultExportFormat') || 'PDF';
  });
  const [defaultReportPeriod, setDefaultReportPeriod] = useState(() => {
    return localStorage.getItem('defaultReportPeriod') || 'monthly';
  });
  const [includeCharts, setIncludeCharts] = useState(() => {
    const saved = localStorage.getItem('includeCharts');
    return saved !== null ? saved === 'true' : true;
  });

  // Email/Notification Templates
  const [emailNotifications, setEmailNotifications] = useState(() => {
    const saved = localStorage.getItem('emailNotifications');
    return saved !== null ? saved === 'true' : true;
  });
  const [notificationFrequency, setNotificationFrequency] = useState(() => {
    return localStorage.getItem('notificationFrequency') || 'daily';
  });

  // Security Options
  const [sessionTimeout, setSessionTimeout] = useState(() => {
    return localStorage.getItem('sessionTimeout') || '30';
  });
  const [requireTwoFactor, setRequireTwoFactor] = useState(() => {
    const saved = localStorage.getItem('requireTwoFactor');
    return saved !== null ? saved === 'true' : false;
  });
  const [passwordExpiry, setPasswordExpiry] = useState(() => {
    return localStorage.getItem('passwordExpiry') || '90';
  });

  // Audit Log Retention
  const [auditLogRetention, setAuditLogRetention] = useState(() => {
    return localStorage.getItem('auditLogRetention') || '365';
  });
  const [autoArchiveLogs, setAutoArchiveLogs] = useState(() => {
    const saved = localStorage.getItem('autoArchiveLogs');
    return saved !== null ? saved === 'true' : true;
  });

  // API Integration Settings
  const [tookanApiCode, setTookanApiCode] = useState(() => {
    return localStorage.getItem('tookanApiCode') || '';
  });

  useEffect(() => {
    localStorage.setItem('showCODSection', String(showCODSection));
    // Dispatch custom event to notify other components
    window.dispatchEvent(new Event('settingsUpdated'));
  }, [showCODSection]);

  useEffect(() => {
    localStorage.setItem('showDriverWalletSection', String(showDriverWalletSection));
    window.dispatchEvent(new Event('settingsUpdated'));
  }, [showDriverWalletSection]);

  useEffect(() => {
    localStorage.setItem('showCustomerWalletSection', String(showCustomerWalletSection));
    window.dispatchEvent(new Event('settingsUpdated'));
  }, [showCustomerWalletSection]);

  // Save date/time format settings
  useEffect(() => {
    localStorage.setItem('dateFormat', dateFormat);
    window.dispatchEvent(new Event('settingsUpdated'));
  }, [dateFormat]);

  useEffect(() => {
    localStorage.setItem('timeFormat', timeFormat);
    window.dispatchEvent(new Event('settingsUpdated'));
  }, [timeFormat]);

  useEffect(() => {
    localStorage.setItem('timezone', timezone);
    window.dispatchEvent(new Event('settingsUpdated'));
  }, [timezone]);

  // Save export/report defaults
  useEffect(() => {
    localStorage.setItem('defaultExportFormat', defaultExportFormat);
    window.dispatchEvent(new Event('settingsUpdated'));
  }, [defaultExportFormat]);

  useEffect(() => {
    localStorage.setItem('defaultReportPeriod', defaultReportPeriod);
    window.dispatchEvent(new Event('settingsUpdated'));
  }, [defaultReportPeriod]);

  useEffect(() => {
    localStorage.setItem('includeCharts', String(includeCharts));
    window.dispatchEvent(new Event('settingsUpdated'));
  }, [includeCharts]);

  // Save email/notification settings
  useEffect(() => {
    localStorage.setItem('emailNotifications', String(emailNotifications));
    window.dispatchEvent(new Event('settingsUpdated'));
  }, [emailNotifications]);

  useEffect(() => {
    localStorage.setItem('notificationFrequency', notificationFrequency);
    window.dispatchEvent(new Event('settingsUpdated'));
  }, [notificationFrequency]);

  // Save security settings
  useEffect(() => {
    localStorage.setItem('sessionTimeout', sessionTimeout);
    window.dispatchEvent(new Event('settingsUpdated'));
  }, [sessionTimeout]);

  useEffect(() => {
    localStorage.setItem('requireTwoFactor', String(requireTwoFactor));
    window.dispatchEvent(new Event('settingsUpdated'));
  }, [requireTwoFactor]);

  useEffect(() => {
    localStorage.setItem('passwordExpiry', passwordExpiry);
    window.dispatchEvent(new Event('settingsUpdated'));
  }, [passwordExpiry]);

  // Save audit log settings
  useEffect(() => {
    localStorage.setItem('auditLogRetention', auditLogRetention);
    window.dispatchEvent(new Event('settingsUpdated'));
  }, [auditLogRetention]);

  useEffect(() => {
    localStorage.setItem('autoArchiveLogs', String(autoArchiveLogs));
    window.dispatchEvent(new Event('settingsUpdated'));
  }, [autoArchiveLogs]);

  // Save API integration settings
  useEffect(() => {
    localStorage.setItem('tookanApiCode', tookanApiCode);
    window.dispatchEvent(new Event('settingsUpdated'));
  }, [tookanApiCode]);

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-heading text-3xl mb-2">Settings</h1>
        <p className="text-subheading">Configure your system preferences</p>
      </div>

      {/* Display Preferences */}
      <div className="bg-card rounded-2xl border border-border p-6 shadow-sm transition-colors duration-300">
        <h3 className="text-foreground mb-4">Display Preferences</h3>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-muted/30 rounded-xl transition-colors duration-300">
            <div className="flex items-center gap-4">
              {theme === 'dark' ? (
                <Moon className="w-6 h-6 text-heading" />
              ) : (
                <Sun className="w-6 h-6 text-heading" />
              )}
              <div>
                <p className="text-foreground">Theme Mode</p>
                <p className="text-sm text-muted-foreground">
                  {theme === 'dark' ? 'Dark mode enabled' : 'Light mode enabled'}
                </p>
              </div>
            </div>
            
            <button
              onClick={toggleTheme}
              className="relative inline-flex h-10 w-20 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#C1EEFA] focus:ring-offset-2"
              style={{
                backgroundColor: theme === 'dark' ? '#C1EEFA' : '#5B7894'
              }}
            >
              <span
                className={`inline-block h-8 w-8 transform rounded-full bg-white shadow-lg transition-transform ${
                  theme === 'dark' ? 'translate-x-10' : 'translate-x-1'
                }`}
              >
                {theme === 'dark' ? (
                  <Moon className="w-5 h-5 m-1.5 text-[#1A2C53]" />
                ) : (
                  <Sun className="w-5 h-5 m-1.5 text-[#5B7894]" />
                )}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Financial Panel Preferences */}
      <div className="bg-card rounded-2xl border border-border p-6 shadow-sm transition-colors duration-300">
        <h3 className="text-foreground mb-4">Financial Panel Preferences</h3>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-muted/30 rounded-xl transition-colors duration-300">
            <div className="flex items-center gap-4">
              <Wallet className="w-6 h-6 text-heading" />
              <div>
                <p className="text-foreground">Driver Wallets Section</p>
                <p className="text-sm text-muted-foreground">
                  {showDriverWalletSection ? 'Visible in Financial Panel' : 'Hidden from Financial Panel'}
                </p>
              </div>
            </div>
            
            <button
              onClick={() => setShowDriverWalletSection(!showDriverWalletSection)}
              className="relative inline-flex h-10 w-20 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#C1EEFA] focus:ring-offset-2"
              style={{
                backgroundColor: showDriverWalletSection ? '#C1EEFA' : '#5B7894'
              }}
            >
              <span
                className={`inline-block h-8 w-8 transform rounded-full bg-white shadow-lg transition-transform ${
                  showDriverWalletSection ? 'translate-x-10' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between p-4 bg-muted/30 rounded-xl transition-colors duration-300">
            <div className="flex items-center gap-4">
              <Wallet className="w-6 h-6 text-heading" />
              <div>
                <p className="text-foreground">Customer Wallets Section</p>
                <p className="text-sm text-muted-foreground">
                  {showCustomerWalletSection ? 'Visible in Financial Panel' : 'Hidden from Financial Panel'}
                </p>
              </div>
            </div>
            
            <button
              onClick={() => setShowCustomerWalletSection(!showCustomerWalletSection)}
              className="relative inline-flex h-10 w-20 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#C1EEFA] focus:ring-offset-2"
              style={{
                backgroundColor: showCustomerWalletSection ? '#C1EEFA' : '#5B7894'
              }}
            >
              <span
                className={`inline-block h-8 w-8 transform rounded-full bg-white shadow-lg transition-transform ${
                  showCustomerWalletSection ? 'translate-x-10' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Delivery Charge Tags Configuration */}
      <div className="bg-card rounded-2xl border border-border p-6 shadow-sm transition-colors duration-300">
        <div className="flex items-center gap-3 mb-4">
          <Tag className="w-5 h-5 text-heading" />
          <h3 className="text-foreground">Delivery Charge Tags</h3>
        </div>
        <TagConfigurationSection />
      </div>

      {/* Date & Time Formats */}
      <div className="bg-card rounded-2xl border border-border p-6 shadow-sm transition-colors duration-300">
        <div className="flex items-center gap-3 mb-4">
          <Calendar className="w-5 h-5 text-heading" />
          <h3 className="text-foreground">Date & Time Formats</h3>
        </div>
        
        <div className="space-y-4">
          <div>
            <label className="block text-heading text-sm mb-2">Date Format</label>
            <select
              value={dateFormat}
              onChange={(e) => setDateFormat(e.target.value)}
              className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl px-4 py-3 text-heading dark:text-[#C1EEFA] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA] focus:shadow-[0_0_12px_rgba(222,53,68,0.3)] dark:focus:shadow-[0_0_12px_rgba(193,238,250,0.3)] transition-all"
            >
              <option value="DD/MM/YYYY">DD/MM/YYYY (e.g., 09/12/2025)</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY (e.g., 12/09/2025)</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD (e.g., 2025-12-09)</option>
              <option value="DD-MM-YYYY">DD-MM-YYYY (e.g., 09-12-2025)</option>
              <option value="MMM DD, YYYY">MMM DD, YYYY (e.g., Dec 09, 2025)</option>
            </select>
          </div>

          <div>
            <label className="block text-heading text-sm mb-2">Time Format</label>
            <select
              value={timeFormat}
              onChange={(e) => setTimeFormat(e.target.value)}
              className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl px-4 py-3 text-heading dark:text-[#C1EEFA] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA] focus:shadow-[0_0_12px_rgba(222,53,68,0.3)] dark:focus:shadow-[0_0_12px_rgba(193,238,250,0.3)] transition-all"
            >
              <option value="24h">24-hour format (e.g., 14:30)</option>
              <option value="12h">12-hour format (e.g., 2:30 PM)</option>
            </select>
          </div>

          <div>
            <label className="block text-heading text-sm mb-2">Timezone</label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl px-4 py-3 text-heading dark:text-[#C1EEFA] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA] focus:shadow-[0_0_12px_rgba(222,53,68,0.3)] dark:focus:shadow-[0_0_12px_rgba(193,238,250,0.3)] transition-all"
            >
              <option value="Asia/Bahrain">Asia/Bahrain (GMT+3)</option>
              <option value="Asia/Riyadh">Asia/Riyadh (GMT+3)</option>
              <option value="Asia/Dubai">Asia/Dubai (GMT+4)</option>
              <option value="Asia/Kuwait">Asia/Kuwait (GMT+3)</option>
              <option value="Asia/Muscat">Asia/Muscat (GMT+4)</option>
              <option value="Asia/Qatar">Asia/Qatar (GMT+3)</option>
              <option value="UTC">UTC (GMT+0)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Export/Report Defaults */}
      <div className="bg-card rounded-2xl border border-border p-6 shadow-sm transition-colors duration-300">
        <div className="flex items-center gap-3 mb-4">
          <FileText className="w-5 h-5 text-heading" />
          <h3 className="text-foreground">Export/Report Defaults</h3>
        </div>
        
        <div className="space-y-4">
          <div>
            <label className="block text-heading text-sm mb-2">Default Export Format</label>
            <select
              value={defaultExportFormat}
              onChange={(e) => setDefaultExportFormat(e.target.value)}
              className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl px-4 py-3 text-heading dark:text-[#C1EEFA] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA] focus:shadow-[0_0_12px_rgba(222,53,68,0.3)] dark:focus:shadow-[0_0_12px_rgba(193,238,250,0.3)] transition-all"
            >
              <option value="PDF">PDF</option>
              <option value="Excel">Excel (XLSX)</option>
              <option value="CSV">CSV</option>
              <option value="JSON">JSON</option>
            </select>
          </div>

          <div>
            <label className="block text-heading text-sm mb-2">Default Report Period</label>
            <select
              value={defaultReportPeriod}
              onChange={(e) => setDefaultReportPeriod(e.target.value)}
              className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl px-4 py-3 text-heading dark:text-[#C1EEFA] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA] focus:shadow-[0_0_12px_rgba(222,53,68,0.3)] dark:focus:shadow-[0_0_12px_rgba(193,238,250,0.3)] transition-all"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>

          <div className="flex items-center justify-between p-4 bg-muted/30 rounded-xl transition-colors duration-300">
            <div>
              <p className="text-foreground">Include Charts in Reports</p>
              <p className="text-sm text-muted-foreground">
                Add visual charts to exported reports
              </p>
            </div>
            <button
              onClick={() => setIncludeCharts(!includeCharts)}
              className="relative inline-flex h-10 w-20 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#C1EEFA] focus:ring-offset-2"
              style={{
                backgroundColor: includeCharts ? '#C1EEFA' : '#5B7894'
              }}
            >
              <span
                className={`inline-block h-8 w-8 transform rounded-full bg-white shadow-lg transition-transform ${
                  includeCharts ? 'translate-x-10' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Email/Notification Templates */}
      <div className="bg-card rounded-2xl border border-border p-6 shadow-sm transition-colors duration-300">
        <div className="flex items-center gap-3 mb-4">
          <Mail className="w-5 h-5 text-heading" />
          <h3 className="text-foreground">Email/Notification Templates</h3>
        </div>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-muted/30 rounded-xl transition-colors duration-300">
            <div>
              <p className="text-foreground">Email Notifications</p>
              <p className="text-sm text-muted-foreground">
                Enable email notifications for system events
              </p>
            </div>
            <button
              onClick={() => setEmailNotifications(!emailNotifications)}
              className="relative inline-flex h-10 w-20 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#C1EEFA] focus:ring-offset-2"
              style={{
                backgroundColor: emailNotifications ? '#C1EEFA' : '#5B7894'
              }}
            >
              <span
                className={`inline-block h-8 w-8 transform rounded-full bg-white shadow-lg transition-transform ${
                  emailNotifications ? 'translate-x-10' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div>
            <label className="block text-heading text-sm mb-2">Notification Frequency</label>
            <select
              value={notificationFrequency}
              onChange={(e) => setNotificationFrequency(e.target.value)}
              className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl px-4 py-3 text-heading dark:text-[#C1EEFA] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA] focus:shadow-[0_0_12px_rgba(222,53,68,0.3)] dark:focus:shadow-[0_0_12px_rgba(193,238,250,0.3)] transition-all"
            >
              <option value="realtime">Real-time</option>
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
        </div>
      </div>

      {/* Security Options */}
      <div className="bg-card rounded-2xl border border-border p-6 shadow-sm transition-colors duration-300">
        <div className="flex items-center gap-3 mb-4">
          <Shield className="w-5 h-5 text-heading" />
          <h3 className="text-foreground">Security Options</h3>
        </div>
        
        <div className="space-y-4">
          <div>
            <label className="block text-heading text-sm mb-2">Session Timeout (minutes)</label>
            <input
              type="number"
              value={sessionTimeout}
              onChange={(e) => setSessionTimeout(e.target.value)}
              min="5"
              max="480"
              className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl px-4 py-3 text-heading dark:text-[#C1EEFA] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA] focus:shadow-[0_0_12px_rgba(222,53,68,0.3)] dark:focus:shadow-[0_0_12px_rgba(193,238,250,0.3)] transition-all"
            />
            <p className="text-xs text-muted-foreground mt-1">Automatic logout after inactivity (5-480 minutes)</p>
          </div>

          <div className="flex items-center justify-between p-4 bg-muted/30 rounded-xl transition-colors duration-300">
            <div>
              <p className="text-foreground">Require Two-Factor Authentication</p>
              <p className="text-sm text-muted-foreground">
                Enable 2FA for enhanced security
              </p>
            </div>
            <button
              onClick={() => setRequireTwoFactor(!requireTwoFactor)}
              className="relative inline-flex h-10 w-20 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#C1EEFA] focus:ring-offset-2"
              style={{
                backgroundColor: requireTwoFactor ? '#C1EEFA' : '#5B7894'
              }}
            >
              <span
                className={`inline-block h-8 w-8 transform rounded-full bg-white shadow-lg transition-transform ${
                  requireTwoFactor ? 'translate-x-10' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div>
            <label className="block text-heading text-sm mb-2">Password Expiry (days)</label>
            <input
              type="number"
              value={passwordExpiry}
              onChange={(e) => setPasswordExpiry(e.target.value)}
              min="30"
              max="365"
              className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl px-4 py-3 text-heading dark:text-[#C1EEFA] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA] focus:shadow-[0_0_12px_rgba(222,53,68,0.3)] dark:focus:shadow-[0_0_12px_rgba(193,238,250,0.3)] transition-all"
            />
            <p className="text-xs text-muted-foreground mt-1">Force password change after specified days (30-365)</p>
          </div>
        </div>
      </div>

      {/* API Integration Settings */}
      <div className="bg-card rounded-2xl border border-border p-6 shadow-sm transition-colors duration-300">
        <div className="flex items-center gap-3 mb-4">
          <Key className="w-5 h-5 text-heading" />
          <h3 className="text-foreground">API Integration Settings</h3>
        </div>
        
        <div className="space-y-4">
          <div>
            <label className="block text-heading text-sm mb-2">Tookan API Code</label>
            <input
              type="password"
              value={tookanApiCode}
              onChange={(e) => setTookanApiCode(e.target.value)}
              placeholder="Enter your Tookan API code"
              className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl px-4 py-3 text-heading dark:text-[#C1EEFA] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA] focus:shadow-[0_0_12px_rgba(222,53,68,0.3)] dark:focus:shadow-[0_0_12px_rgba(193,238,250,0.3)] transition-all"
            />
            <p className="text-xs text-muted-foreground mt-1">Enter your Tookan API code to connect to your Tookan account</p>
          </div>
        </div>
      </div>

      {/* Audit Log Retention Settings */}
      <div className="bg-card rounded-2xl border border-border p-6 shadow-sm transition-colors duration-300">
        <div className="flex items-center gap-3 mb-4">
          <Archive className="w-5 h-5 text-heading" />
          <h3 className="text-foreground">Audit Log Retention Settings</h3>
        </div>
        
        <div className="space-y-4">
          <div>
            <label className="block text-heading text-sm mb-2">Log Retention Period (days)</label>
            <input
              type="number"
              value={auditLogRetention}
              onChange={(e) => setAuditLogRetention(e.target.value)}
              min="30"
              max="2555"
              className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl px-4 py-3 text-heading dark:text-[#C1EEFA] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA] focus:shadow-[0_0_12px_rgba(222,53,68,0.3)] dark:focus:shadow-[0_0_12px_rgba(193,238,250,0.3)] transition-all"
            />
            <p className="text-xs text-muted-foreground mt-1">Keep audit logs for specified number of days (30-2555 days)</p>
          </div>

          <div className="flex items-center justify-between p-4 bg-muted/30 rounded-xl transition-colors duration-300">
            <div>
              <p className="text-foreground">Auto-Archive Logs</p>
              <p className="text-sm text-muted-foreground">
                Automatically archive logs older than retention period
              </p>
            </div>
            <button
              onClick={() => setAutoArchiveLogs(!autoArchiveLogs)}
              className="relative inline-flex h-10 w-20 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#C1EEFA] focus:ring-offset-2"
              style={{
                backgroundColor: autoArchiveLogs ? '#C1EEFA' : '#5B7894'
              }}
            >
              <span
                className={`inline-block h-8 w-8 transform rounded-full bg-white shadow-lg transition-transform ${
                  autoArchiveLogs ? 'translate-x-10' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* System Information */}
      <div className="bg-card rounded-2xl border border-border p-6 shadow-sm transition-colors duration-300">
        <h3 className="text-foreground mb-4">System Information</h3>
        <div className="space-y-3">
          <div className="flex justify-between py-2 border-b border-border">
            <span className="text-muted-foreground">Version</span>
            <span className="text-foreground">v2.4.1</span>
          </div>
          <div className="flex justify-between py-2 border-b border-border">
            <span className="text-muted-foreground">Last Updated</span>
            <span className="text-foreground">December 9, 2025</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Environment</span>
            <span className="text-foreground">Production</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Tag Configuration Component
function TagConfigurationSection() {
  const [tagConfig, setTagConfig] = useState<TagConfig>({ rules: [], tags: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [newRule, setNewRule] = useState({ condition: '', tags: '', description: '' });
  const [testData, setTestData] = useState({ plan: '', zone: '', city: '' });
  const [suggestedTags, setSuggestedTags] = useState<string[]>([]);

  useEffect(() => {
    loadTagConfig();
  }, []);

  const loadTagConfig = async () => {
    setIsLoading(true);
    try {
      const result = await getTagConfig();
      if (result.status === 'success' && result.data) {
        setTagConfig(result.data);
      }
    } catch (error) {
      toast.error('Failed to load tag configuration');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const result = await updateTagConfig(tagConfig);
      if (result.status === 'success') {
        toast.success('Tag configuration saved successfully');
        setTagConfig(result.data);
      } else {
        toast.error(result.message || 'Failed to save tag configuration');
      }
    } catch (error) {
      toast.error('Failed to save tag configuration');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddRule = () => {
    if (!newRule.condition || !newRule.tags) {
      toast.error('Please fill in condition and tags');
      return;
    }

    const tagsArray = newRule.tags.split(',').map(t => t.trim()).filter(t => t);
    if (tagsArray.length === 0) {
      toast.error('Please provide at least one tag');
      return;
    }

    setTagConfig({
      ...tagConfig,
      rules: [
        ...(tagConfig.rules || []),
        {
          condition: newRule.condition,
          tags: tagsArray,
          description: newRule.description
        }
      ]
    });

    setNewRule({ condition: '', tags: '', description: '' });
  };

  const handleRemoveRule = (index: number) => {
    const newRules = [...(tagConfig.rules || [])];
    newRules.splice(index, 1);
    setTagConfig({ ...tagConfig, rules: newRules });
  };

  const handleTestTags = async () => {
    if (!testData.plan && !testData.zone && !testData.city) {
      toast.error('Please provide at least one test value');
      return;
    }

    try {
      const result = await suggestTags(testData);
      if (result.status === 'success' && result.data) {
        setSuggestedTags(result.data.tags);
        toast.success(`Suggested tags: ${result.data.tags.join(', ') || 'None'}`);
      }
    } catch (error) {
      toast.error('Failed to test tags');
    }
  };

  if (isLoading) {
    return <div className="text-heading">Loading tag configuration...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Existing Rules */}
      <div>
        <h4 className="text-heading mb-3">Tag Assignment Rules</h4>
        <div className="space-y-3">
          {(tagConfig.rules || []).map((rule, index) => (
            <div key={index} className="p-4 bg-muted/30 rounded-xl border border-border">
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <div className="text-sm font-medium text-heading mb-1">
                    Condition: <code className="bg-background px-2 py-1 rounded">{rule.condition}</code>
                  </div>
                  <div className="text-sm text-heading mb-1">
                    Tags: {rule.tags.map(tag => (
                      <span key={tag} className="inline-block bg-primary/20 text-primary px-2 py-1 rounded mr-1 mb-1">
                        {tag}
                      </span>
                    ))}
                  </div>
                  {rule.description && (
                    <div className="text-xs text-muted-foreground">{rule.description}</div>
                  )}
                </div>
                <button
                  onClick={() => handleRemoveRule(index)}
                  className="p-2 hover:bg-destructive/20 rounded-lg text-destructive transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
          {(!tagConfig.rules || tagConfig.rules.length === 0) && (
            <div className="text-sm text-muted-foreground p-4 bg-muted/30 rounded-xl text-center">
              No rules configured. Add a rule below to get started.
            </div>
          )}
        </div>
      </div>

      {/* Add New Rule */}
      <div className="p-4 bg-muted/30 rounded-xl border border-border">
        <h4 className="text-heading mb-3">Add New Rule</h4>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-heading mb-1">Condition (e.g., plan === 'premium')</label>
            <input
              type="text"
              value={newRule.condition}
              onChange={(e) => setNewRule({ ...newRule, condition: e.target.value })}
              placeholder="plan === 'premium'"
              className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl px-4 py-2 text-heading dark:text-[#C1EEFA] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA]"
            />
          </div>
          <div>
            <label className="block text-sm text-heading mb-1">Tags (comma-separated)</label>
            <input
              type="text"
              value={newRule.tags}
              onChange={(e) => setNewRule({ ...newRule, tags: e.target.value })}
              placeholder="DELIVERY_TIER_A, PREMIUM_CUSTOMER"
              className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl px-4 py-2 text-heading dark:text-[#C1EEFA] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA]"
            />
          </div>
          <div>
            <label className="block text-sm text-heading mb-1">Description (optional)</label>
            <input
              type="text"
              value={newRule.description}
              onChange={(e) => setNewRule({ ...newRule, description: e.target.value })}
              placeholder="Premium plan customers"
              className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl px-4 py-2 text-heading dark:text-[#C1EEFA] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA]"
            />
          </div>
          <button
            onClick={handleAddRule}
            className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Add Rule
          </button>
        </div>
      </div>

      {/* Test Tags */}
      <div className="p-4 bg-muted/30 rounded-xl border border-border">
        <h4 className="text-heading mb-3">Test Tag Assignment</h4>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm text-heading mb-1">Plan</label>
              <input
                type="text"
                value={testData.plan}
                onChange={(e) => setTestData({ ...testData, plan: e.target.value })}
                placeholder="premium"
                className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl px-4 py-2 text-heading dark:text-[#C1EEFA] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA]"
              />
            </div>
            <div>
              <label className="block text-sm text-heading mb-1">Zone</label>
              <input
                type="text"
                value={testData.zone}
                onChange={(e) => setTestData({ ...testData, zone: e.target.value })}
                placeholder="A"
                className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl px-4 py-2 text-heading dark:text-[#C1EEFA] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA]"
              />
            </div>
            <div>
              <label className="block text-sm text-heading mb-1">City</label>
              <input
                type="text"
                value={testData.city}
                onChange={(e) => setTestData({ ...testData, city: e.target.value })}
                placeholder="Manama"
                className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl px-4 py-2 text-heading dark:text-[#C1EEFA] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA]"
              />
            </div>
          </div>
          <button
            onClick={handleTestTags}
            className="w-full px-4 py-2 bg-secondary text-secondary-foreground rounded-xl hover:bg-secondary/90 transition-colors"
          >
            Test Tags
          </button>
          {suggestedTags.length > 0 && (
            <div className="p-3 bg-background rounded-xl">
              <div className="text-sm text-heading mb-2">Suggested Tags:</div>
              <div className="flex flex-wrap gap-2">
                {suggestedTags.map(tag => (
                  <span key={tag} className="inline-block bg-primary/20 text-primary px-2 py-1 rounded text-sm">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Save Button */}
      <button
        onClick={handleSave}
        disabled={isSaving}
        className="w-full px-4 py-3 bg-[#C1EEFA] text-[#1A2C53] rounded-xl hover:shadow-[0_0_16px_rgba(193,238,250,0.4)] transition-all flex items-center justify-center gap-2 font-semibold disabled:opacity-50"
      >
        <Save className="w-5 h-5" />
        {isSaving ? 'Saving...' : 'Save Tag Configuration'}
      </button>
    </div>
  );
}
