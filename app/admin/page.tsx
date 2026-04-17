"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { LayoutDashboard, Package, ShoppingCart, ClipboardList, Lock } from 'lucide-react';

// --- IMPORTACIONES CORREGIDAS DEFINITIVAS ---
// 2 saltos (../../) porque lib y types están en la raíz del proyecto
import { supabase } from '../../lib/supabase';
import { Product, Sale, Restock, PendingOrder } from '../../types';

// 1 salto (../) porque components está dentro de la carpeta app
import { DashboardView } from '../components/views/DashboardView';
import { RecordSaleView } from '../components/views/RecordSaleView';
import { InventoryView } from '../components/views/InventoryView';
import { PendingOrdersView } from '../components/views/PendingOrdersView';

const STORE_ACCESS_PIN = "4321";

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('ventas');
  
  // --- SOLUCIÓN DE PERSISTENCIA ---
  const [user] = useState<{ id: string }>({ id: '00000000-0000-0000-0000-000000000000' });
  
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [restocks, setRestocks] = useState<Restock[]>([]);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const savedAccess = localStorage.getItem('wolfe_socks_admin_access');
    if (savedAccess === 'granted') setIsAuthenticated(true);
    setAuthChecked(true);
  }, []);

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pinInput === STORE_ACCESS_PIN) {
      setIsAuthenticated(true);
      localStorage.setItem('wolfe_socks_admin_access', 'granted');
    } else {
      setPinError(true);
      setPinInput('');
      setTimeout(() => setPinError(false), 2000);
    }
  };

  const fetchData = useCallback(async () => {
    if (!supabase || !isAuthenticated) return;
    
    const { data: prods } = await supabase.from('products').select('*');
    if (prods) setProducts((prods as Product[]).map((p) => ({ ...p, imageUrl: p.image_url })));
    
    const { data: rsData } = await supabase.from('restocks').select('*').order('date', { ascending: false });
    if (rsData) setRestocks(rsData as Restock[]);
    
    const { data: sData } = await supabase.from('sales').select('*').order('date', { ascending: false });
    if (sData) setSales((sData as Sale[]).map(s => ({ 
      ...s, 
      productId: s.product_id, 
      salePrice: s.sale_price, 
      costAtSale: s.cost_at_sale, 
      clientName: s.client_name 
    })));
    
    const { data: oData } = await supabase.from('pending_orders').select('*').order('date', { ascending: false });
    if (oData) setPendingOrders(oData as PendingOrder[]);
  }, [isAuthenticated]);

  useEffect(() => {
    if (!supabase || !isAuthenticated) return;
    
    fetchData();

    const channel = supabase.channel('realtime-socks')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restocks' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pending_orders' }, fetchData)
      .subscribe();
      
    return () => { 
      channel.unsubscribe(); 
    };
  }, [fetchData, isAuthenticated]);

  if (!authChecked) return null;

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#F4F5F4] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-[#EAEAEC] w-full max-w-md animate-in fade-in zoom-in-95">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-[#F9FAFA] rounded-2xl flex items-center justify-center border border-[#EAEAEC]">
              <Lock size={28} className="text-[#111111]" />
            </div>
          </div>
          <h2 className="text-2xl font-medium text-center text-[#111111] tracking-tight mb-2">Acceso Administrativo</h2>
          <p className="text-center text-[#71717A] text-sm mb-8">Ingresa el PIN de seguridad.</p>
          <form onSubmit={handlePinSubmit} className="space-y-4">
            <input 
              type="password" 
              value={pinInput} 
              onChange={e => setPinInput(e.target.value)} 
              placeholder="••••" 
              className={`w-full px-5 py-4 bg-[#F9FAFA] border ${pinError ? 'border-red-500' : 'border-[#EAEAEC]'} rounded-[1.25rem] text-center text-2xl tracking-[0.5em] outline-none transition-all`}
              autoFocus 
            />
            <button type="submit" className="w-full bg-[#1A1A1A] text-white font-medium py-4 rounded-[1.25rem] hover:bg-black transition-all active:scale-[0.98]">
              Desbloquear Panel
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F4F5F4] text-[#111111] font-sans flex flex-col md:flex-row">
      <aside className="w-full md:w-64 bg-[#F4F5F4] text-[#71717A] flex-shrink-0 flex flex-col border-r border-[#EAEAEC] relative z-20">
        <div className="p-6">
          <h1 className="text-2xl font-bold tracking-tighter text-[#111111] flex items-center gap-2">
            <Package className="text-[#1A1A1A]" /> SocksManager
          </h1>
        </div>
        <nav className="flex-1 px-4 space-y-2 pb-6 md:pb-0">
          <NavButton active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<LayoutDashboard size={20} />} label="Dashboard" />
          <NavButton active={activeTab === 'ventas'} onClick={() => setActiveTab('ventas')} icon={<ShoppingCart size={20} />} label="Registrar Venta" />
          <NavButton active={activeTab === 'inventario'} onClick={() => setActiveTab('inventario')} icon={<Package size={20} />} label="Inventario" />
          <NavButton active={activeTab === 'pedidos'} onClick={() => setActiveTab('pedidos')} icon={<ClipboardList size={20} />} label="Pedidos Pendientes" />
        </nav>
      </aside>

      <main className="flex-1 p-4 md:p-8 overflow-y-auto w-full">
        {activeTab === 'dashboard' && (
          <DashboardView 
            stats={{ 
              totalRevenue: sales.reduce((a, b) => a + (b.salePrice * b.quantity), 0), 
              totalProfit: sales.reduce((a, b) => a + ((b.salePrice - b.costAtSale) * b.quantity), 0), 
              itemsSold: sales.reduce((a, b) => a + b.quantity, 0) 
            }} 
            sales={sales} 
            products={products} 
            onRefresh={fetchData} 
          />
        )}
        {activeTab === 'ventas' && <RecordSaleView products={products} userId={user.id} onRefresh={fetchData} />}
        {activeTab === 'inventario' && <InventoryView products={products} userId={user.id} sales={sales} restocks={restocks} onRefresh={fetchData} />}
        {activeTab === 'pedidos' && <PendingOrdersView products={products} userId={user.id} pendingOrders={pendingOrders} onRefresh={fetchData} />}
      </main>
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button 
      onClick={onClick} 
      className={`w-full flex items-center space-x-3 px-4 py-3.5 rounded-[1.25rem] transition-all duration-200 ${
        active 
          ? 'bg-[#1A1A1A] text-white shadow-lg font-medium' 
          : 'text-[#71717A] hover:bg-[#EAEAEC]/60 hover:text-[#111111]'
      }`}
    >
      {icon} <span>{label}</span>
    </button>
  );
}