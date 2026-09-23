import React from 'react';
import { Link } from 'react-router-dom';
import { IconMenu } from './icons.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function Header({ onMenuClick }) {
  const { authenticated, tenantName, selectedTenantId } = useAuth();

  return (
    <header className="h-16 shrink-0 border-b border-line bg-white flex items-center justify-between px-4 lg:px-8">
      <button className="lg:hidden text-ink-500" onClick={onMenuClick} aria-label="Open menu">
        <IconMenu />
      </button>

      <div className="hidden lg:block" />

      <div className="flex items-center gap-4">
        {authenticated && (
          <Link
            to="/select-organisation"
            className="flex items-center gap-2 rounded-full border border-line pl-2 pr-3 py-1 text-sm hover:bg-ink-900/5"
            title="Switch organisation"
          >
            <span className={`h-2 w-2 rounded-full ${selectedTenantId ? 'bg-success-600' : 'bg-danger-600'}`} />
            <span className="text-ink-700 font-medium max-w-[12rem] truncate">
              {tenantName || (selectedTenantId ? selectedTenantId : 'No organisation')}
            </span>
          </Link>
        )}
      </div>
    </header>
  );
}
