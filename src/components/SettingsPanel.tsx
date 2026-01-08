import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

export function SettingsPanel() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-heading text-3xl mb-2">Settings</h1>
        <p className="text-subheading">Configure your display preferences</p>
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
            <span className="text-foreground">January 8, 2026</span>
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
