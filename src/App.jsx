import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import ReceiptScan from './pages/ReceiptScan';
import Transactions from './pages/Transactions';
import ManualEntry from './pages/ManualEntry';
import VoiceEntry from './pages/VoiceEntry';
import Insights from './pages/Insights';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route element={<Layout />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/scan" element={<ReceiptScan />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/add" element={<ManualEntry />} />
        <Route path="/voice" element={<VoiceEntry />} />
        <Route path="/insights" element={<Insights />} />
      </Route>
    </Routes>
  );
}
