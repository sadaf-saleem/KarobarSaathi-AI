import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';

export default function Layout() {
  return (
    <div className="min-h-screen bg-surface-50">
      <Navbar />
      <main className="page-enter">
        <Outlet />
      </main>
    </div>
  );
}
