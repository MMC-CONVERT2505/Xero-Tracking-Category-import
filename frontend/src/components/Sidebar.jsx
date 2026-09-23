import React from 'react';
import { NavLink } from 'react-router-dom';
import { IconGrid, IconTag, IconHistory, IconLink, IconSettings, IconHelp, IconLogout, IconClose } from './icons.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: IconGrid, end: true },
  { to: '/tracking-categories', label: 'Tracking Categories', icon: IconTag },
  { to: '/imports', label: 'Import History', icon: IconHistory },
  { to: '/connections', label: 'Connections', icon: IconLink },
  { to: '/settings', label: 'Settings', icon: IconSettings },
];

export default function Sidebar({ open, onClose }) {
  const { logout } = useAuth();

  return (
    <>
      {open && <div className="fixed inset-0 bg-ink-900/40 z-30 lg:hidden" onClick={onClose} />}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-40 w-64 shrink-0 bg-white border-r border-line flex flex-col
          transition-transform duration-200 lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="h-16 flex items-center justify-between px-5 border-b border-line">
          <Brand />
          <button className="lg:hidden text-ink-500" onClick={onClose} aria-label="Close menu"><IconClose /></button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-500 hover:bg-ink-900/5 hover:text-ink-900'
                }`
              }
            >
              <Icon />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-line space-y-1">
          <a
            href="https://developer.xero.com/documentation/api/accounting/trackingcategories"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-ink-500 hover:bg-ink-900/5 hover:text-ink-900"
          >
            <IconHelp /> Help
          </a>
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-ink-500 hover:bg-danger-50 hover:text-danger-700"
          >
            <IconLogout /> Logout
          </button>
        </div>
      </aside>
    </>
  );
}

export function Brand({ size = 'default' }) {
  const dim = size === 'small' ? 'h-7 w-7 text-sm' : 'h-8 w-8 text-base';
  return (
    <div className="flex items-center gap-2.5">
      <div className={`${dim} rounded-lg bg-brand-700 text-white font-semibold flex items-center justify-center`}>X</div>
      <span className="font-semibold text-ink-900 tracking-tight">Tracking Importer</span>
    </div>
  );
}
