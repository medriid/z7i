import { Sun, Moon, User, ArrowLeft, Palette } from 'lucide-react';
import { useTheme } from './App';

interface NotFoundProps {
  onBack?: () => void;
  user?: { name?: string; email: string } | null;
}

export function NotFound({ onBack, user }: NotFoundProps) {
  const { theme, toggleTheme, customThemeEnabled } = useTheme();

  const handleGoBack = () => {
    if (onBack) {
      onBack();
    } else {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        window.location.href = '/';
      }
    }
  };

  return (
    <div className="not-found-page">
      <nav className="not-found-nav">
        <div className="container nav-content">
          <button className="nav-brand-btn" onClick={() => window.location.href = '/'} title="Go to Home">
            <span className="nav-brand">Z7I<span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>Scraper</span></span>
          </button>
          
          <div className="nav-links">
            <button className="theme-toggle" onClick={toggleTheme} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
              {customThemeEnabled ? <Palette size={18} /> : (theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />)}
            </button>
            {user && (
              <div className="user-info-display">
                <div className="user-avatar">
                  <User size={16} />
                </div>
                <span className="user-name">{user.name || user.email}</span>
              </div>
            )}
          </div>
        </div>
      </nav>

      <div className="not-found-content">
        <div className="not-found-card">
          <div className="not-found-404-stack">
            <span className="not-found-404-back">404</span>
            <span className="not-found-404-mid">404</span>
            <span className="not-found-404-front">404</span>
          </div>
          
          <p className="not-found-message">
            You're going nowhere with that, buddy.
          </p>
          
          <button className="not-found-back-btn" onClick={handleGoBack}>
            <ArrowLeft size={18} />
            <span>Take me back</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default NotFound;
