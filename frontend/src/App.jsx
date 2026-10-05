import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AppLayout from './components/AppLayout.jsx';

import Login from './pages/Login.jsx';
import OrganisationSelect from './pages/OrganisationSelect.jsx';
import Dashboard from './pages/Dashboard.jsx';
import TrackingCategories from './pages/TrackingCategories.jsx';
import TrackingCategoryDetail from './pages/TrackingCategoryDetail.jsx';
import TrackingImport from './pages/TrackingImport.jsx';
import ImportProgressPage from './pages/ImportProgressPage.jsx';
import ImportBatchProgressPage from './pages/ImportBatchProgressPage.jsx';
import ImportHistory from './pages/ImportHistory.jsx';
import Connections from './pages/Connections.jsx';
import Settings from './pages/Settings.jsx';

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Login />} />
            <Route
              path="/select-organisation"
              element={<ProtectedRoute requireTenant={false}><OrganisationSelect /></ProtectedRoute>}
            />

            <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/tracking-categories" element={<TrackingCategories />} />
              <Route path="/tracking-categories/import" element={<TrackingImport />} />
              <Route path="/tracking-categories/:trackingCategoryId" element={<TrackingCategoryDetail />} />
              <Route path="/imports" element={<ImportHistory />} />
              <Route path="/imports/batch/:batchId" element={<ImportBatchProgressPage />} />
              <Route path="/imports/:importId" element={<ImportProgressPage />} />
              <Route path="/connections" element={<Connections />} />
              <Route path="/settings" element={<Settings />} />
            </Route>

            <Route path="*" element={<Login />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
