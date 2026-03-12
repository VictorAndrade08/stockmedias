"use client";

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { LayoutDashboard, Package, ShoppingCart, Plus, Search, DollarSign, TrendingUp, PackageMinus, Pencil, X, Bell, RefreshCw, Trash2, ImagePlus, ZoomIn, ClipboardList, CheckCircle, List, LayoutGrid } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

// --- INICIALIZACIÓN DE LA BASE DE DATOS EN LA NUBE (SUPABASE) ---
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY as string;

const supabase = (supabaseUrl && supabaseKey) 
  ? createClient(supabaseUrl, supabaseKey) 
  : null;

// --- SUBIDA DE IMAGEN A CLOUDFLARE R2 ---
async function uploadImageToR2(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/upload-image', { method: 'POST', body: formData });
  if (!res.ok) throw new Error('Error al subir imagen');
  const data = await res.json();
  return data.url as string;
}

// --- BORRADO DE IMAGEN EN CLOUDFLARE R2 ---
async function deleteImageFromR2(imageUrl: string) {
  try {
    const filename = imageUrl.split('/').pop();
    if (!filename) return;
    const res = await fetch('/api/delete-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename })
    });
    if (!res.ok) throw new Error('Error al borrar imagen del bucket');
  } catch (err) {
    console.error('Error al borrar imagen:', err);
  }
}

// --- GEMINI NAME SUGGESTER ---
const GEMINI_API_KEY = process.env.NEXT_PUBLIC_GEMINI_API_KEY as string;

async function suggestProductName(
  imageUrl: string | null,
  currentText: string,
  existingNames: string[]
): Promise<string[]> {
  const namesToShow = existingNames.slice(0, 10).join(', ');
  
  // Prompt optimizado para velocidad, nombres extensos y análisis estricto de imagen
  const prompt = `Eres un asistente experto en catalogación para una tienda de calcetines.
Instrucciones OBLIGATORIAS:
1. Si hay una imagen, analízala minuciosamente para detectar personajes, colores, patrones y franquicias.
2. Combina tus hallazgos visuales con el texto del usuario: "${currentText}".
3. Nombres existentes en inventario: ${namesToShow || 'ninguno'}.
4. Genera nombres EXTENSOS, MUY DESCRIPTIVOS y fáciles de identificar.
5. Sigue ESTRICTAMENTE este formato: "[Franquicia/Estilo/Tema] Medias - [Personaje o Diseño] - [Color/Característica]".
Ejemplo perfecto: "Hora de Aventura Medias - BMO - Verde".
6. Devuelve de 3 a 5 opciones separadas ÚNICAMENTE por el símbolo | sin saltos de línea, sin Markdown, sin numeración y sin asteriscos.`;

  const parts: any[] = [{ text: prompt }];

  if (imageUrl) {
    try {
      const imgRes = await fetch(imageUrl);
      const blob = await imgRes.blob();
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(blob);
      });
      parts.push({ inline_data: { mime_type: blob.type || 'image/jpeg', data: base64 } });
    } catch (err) {
      console.warn('Error al procesar imagen para Gemini:', err);
    }
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.4, // Menos creatividad alucinada, más enfoque en la estructura solicitada
        }
      })
    }
  );

  const data = await res.json();

  if (!res.ok) {
    console.error("Gemini API Error:", data);
    throw new Error(data?.error?.message || 'Error en Gemini API');
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // Limpieza estricta de formato
  const cleanText = text
    .replace(/```[\s\S]*?```/g, '') 
    .replace(/[*_]/g, '')            
    .replace(/\n/g, '|')            
    .replace(/- /g, '');            

  return cleanText.split('|').map((s: string) => s.trim()).filter(Boolean);
}

// --- TIPOS ---
interface Product {
  id: string;
  name: string;
  cost: number;
  price: number;
  stock: number;
  stock_alert?: number | null;
  avg_cost?: number | null;
  image_url?: string | null;
  imageUrl?: string | null;
  user_id?: string;
}

interface Restock {
  id: string;
  product_id: string;
  quantity: number;
  unit_cost: number;
  date: string;
  user_id?: string;
}

interface Sale {
  id: string;
  product_id: string;
  productId: string;
  sale_price: number;
  salePrice: number;
  cost_at_sale: number;
  costAtSale: number;
  quantity: number;
  date: string;
  user_id?: string;
  client_name?: string;
  clientName?: string;
}

interface PendingOrderItem {
  product_id: string;
  name: string;
  quantity: number;
  sale_price: number;
  cost_at_sale: number;
}

interface PendingOrder {
  id: string;
  client_name: string;
  items: PendingOrderItem[];
  total_price: number;
  amount_paid: number;
  is_delivered: boolean;
  date: string;
  user_id?: string;
}

interface DashboardStats {
  totalRevenue: number;
  totalProfit: number;
  itemsSold: number;
}

interface NewProductState {
  name: string;
  cost: string;
  price: string;
  stock: string;
  imagePreview: string | null;
}

interface CartItem {
  product: Product;
  quantity: number;
  salePrice: string;
  saleCost: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('ventas');
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [restocks, setRestocks] = useState<Restock[]>([]);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);

  // --- AUTENTICACIÓN ---
  useEffect(() => {
    if (!supabase) return;

    const initAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        const { data, error } = await supabase.auth.signInAnonymously();
        if (!error) setUser(data?.user ?? null);
      } else {
        setUser(session.user);
      }
    };
    initAuth();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      if (authListener?.subscription) authListener.subscription.unsubscribe();
    };
  }, []);

  // --- CARGA DE DATOS ---
  const fetchData = useCallback(async () => {
    if (!user || !supabase) return;
    const { data: prods } = await supabase.from('products').select('*');
    if (prods) {
      setProducts((prods as Product[]).map((p) => ({ ...p, imageUrl: p.image_url })));
    }
    const { data: restockData } = await supabase.from('restocks').select('*').order('date', { ascending: false });
    if (restockData) setRestocks(restockData as Restock[]);
    const { data: salesData } = await supabase.from('sales').select('*').order('date', { ascending: false });
    if (salesData) {
      setSales((salesData as Sale[]).map((s) => ({
        ...s,
        productId: s.product_id,
        salePrice: s.sale_price,
        costAtSale: s.cost_at_sale,
        clientName: s.client_name
      })));
    }
    const { data: ordersData } = await supabase.from('pending_orders').select('*').order('date', { ascending: false });
    if (ordersData) setPendingOrders(ordersData as PendingOrder[]);
  }, [user]);

  useEffect(() => {
    if (!user || !supabase) return;
    fetchData();
    const channel = supabase.channel('realtime-db')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restocks' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pending_orders' }, fetchData)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, fetchData]);

  const dashboardStats = useMemo<DashboardStats>(() => {
    let totalRevenue = 0, totalProfit = 0, itemsSold = 0;
    sales.forEach(sale => {
      totalRevenue += (sale.salePrice || 0) * (sale.quantity || 0);
      totalProfit += ((sale.salePrice || 0) - (sale.costAtSale || 0)) * (sale.quantity || 0);
      itemsSold += (sale.quantity || 0);
    });
    return { totalRevenue, totalProfit, itemsSold };
  }, [sales]);

  if (!supabase) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#F4F5F4] text-[#71717A]">
        <div className="animate-spin mb-4"><Package size={40} /></div>
        <p className="font-medium">Conectando con Supabase...</p>
        <p className="text-xs mt-2 text-[#A1A1AA]">Si esto tarda mucho, reinicia tu terminal con npm run dev</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F4F5F4] text-[#111111] font-sans flex flex-col md:flex-row selection:bg-[#C8F169] selection:text-[#111111]">
      <aside className="w-full md:w-64 bg-[#F4F5F4] text-[#71717A] flex-shrink-0 flex flex-col border-r border-[#EAEAEC] relative z-20">
        <div className="p-6">
          <h1 className="text-2xl font-bold tracking-tighter text-[#111111] flex items-center gap-2">
            <Package className="text-[#1A1A1A]" /> SocksManager
          </h1>
          <p className="text-[#A1A1AA] text-sm mt-1 font-medium">Gestión de Inventario</p>
        </div>
        <nav className="flex-1 px-4 space-y-2 pb-6 md:pb-0">
          <NavButton active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<LayoutDashboard size={20} />} label="Dashboard" />
          <NavButton active={activeTab === 'ventas'} onClick={() => setActiveTab('ventas')} icon={<ShoppingCart size={20} />} label="Registrar Venta" />
          <NavButton active={activeTab === 'inventario'} onClick={() => setActiveTab('inventario')} icon={<Package size={20} />} label="Inventario" />
          <NavButton active={activeTab === 'pedidos'} onClick={() => setActiveTab('pedidos')} icon={<ClipboardList size={20} />} label="Pedidos Pendientes" />
        </nav>
      </aside>

      <main className="flex-1 p-4 md:p-8 overflow-y-auto w-full">
        {products.filter(p => p.stock_alert != null && p.stock <= (p.stock_alert ?? 0)).length > 0 && (
          <div className="mb-4 md:mb-6 p-4 bg-amber-50 border border-amber-200 rounded-[1.5rem] flex items-start gap-3">
            <Bell size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-amber-700 mb-1">Stock bajo en {products.filter(p => p.stock_alert != null && p.stock <= (p.stock_alert ?? 0)).length} producto(s)</p>
              <div className="flex flex-wrap gap-2 mt-1">
                {products.filter(p => p.stock_alert != null && p.stock <= (p.stock_alert ?? 0)).map(p => (
                  <span key={p.id} className="text-xs font-medium bg-amber-100 text-amber-800 px-3 py-1 rounded-full">{p.name} — {p.stock} en stock</span>
                ))}
              </div>
            </div>
          </div>
        )}
        {activeTab === 'dashboard' && <DashboardView stats={dashboardStats} sales={sales} products={products} onRefresh={fetchData} />}
        {activeTab === 'ventas' && <RecordSaleView products={products} userId={user?.id} onRefresh={fetchData} />}
        {activeTab === 'inventario' && <InventoryView products={products} userId={user?.id} sales={sales} restocks={restocks} onRefresh={fetchData} />}
        {activeTab === 'pedidos' && <PendingOrdersView products={products} userId={user?.id} pendingOrders={pendingOrders} onRefresh={fetchData} />}
      </main>
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick} className={`w-full flex items-center space-x-3 px-4 py-3.5 rounded-[1.25rem] transition-all duration-200 ${active ? 'bg-[#1A1A1A] text-white shadow-lg shadow-black/5 font-medium' : 'text-[#71717A] hover:bg-[#EAEAEC]/60 hover:text-[#111111] font-medium'}`}>
      {icon} <span>{label}</span>
    </button>
  );
}

// --- COMPONENTE REUTILIZABLE: SUGERIDOR DE NOMBRE CON GEMINI ---
function NameSuggester({ imagePreview, currentName, existingNames, onSelect }: {
  imagePreview: string | null;
  currentName: string;
  existingNames: string[];
  onSelect: (name: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSuggest = async () => {
    if (loading || cooldown) return;
    setLoading(true);
    setSuggestions([]);
    setErrorMsg('');
    try {
      const result = await suggestProductName(imagePreview, currentName, existingNames);
      if (result.length === 0) {
        setErrorMsg('Sin sugerencias, intenta de nuevo');
      } else {
        setSuggestions(result);
      }
    } catch (err) {
      console.error('Error al sugerir nombre:', err);
      setErrorMsg('Error al conectar con Gemini');
    } finally {
      setLoading(false);
      setCooldown(true);
      setTimeout(() => setCooldown(false), 8000);
    }
  };

  return (
    <div className="flex gap-2 mt-1.5 flex-wrap items-center">
      <button
        type="button"
        onClick={handleSuggest}
        disabled={loading || cooldown}
        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] hover:text-[#4A6310] bg-[#F9FAFA] hover:bg-[#E8F8B6]/40 border border-[#EAEAEC] hover:border-[#C8F169]/60 px-2.5 py-1 rounded-full transition-all disabled:opacity-50 touch-manipulation"
      >
        {loading ? <><span className="animate-spin inline-block w-2.5 h-2.5 border border-[#A1A1AA] border-t-transparent rounded-full" />...</> : cooldown ? <>⏳ Espera...</> : <>✨ Sugerir</>}
      </button>
      {errorMsg && <span className="text-[10px] text-red-400 font-medium">{errorMsg}</span>}
      {suggestions.map((s, i) => (
        <button
          key={i}
          type="button"
          onClick={() => { onSelect(s); setSuggestions([]); }}
          className="text-[10px] font-medium text-[#4A6310] bg-[#E8F8B6]/60 hover:bg-[#C8F169]/40 border border-[#C8F169]/40 px-2.5 py-1 rounded-full transition-all touch-manipulation"
        >
          {s}
        </button>
      ))}
    </div>
  );
}

// --- VISTA DE PEDIDOS PENDIENTES ---
function PendingOrdersView({ products, userId, pendingOrders, onRefresh }: { products: Product[]; userId?: string; pendingOrders: PendingOrder[]; onRefresh: () => void }) {
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [showAdd, setShowAdd] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  
  // Multi-orden: carrito para pedidos
  const [cart, setCart] = useState<CartItem[]>([]);
  const [clientName, setClientName] = useState<string>('');
  const [orderPaid, setOrderPaid] = useState<string>('0');
  const [isDelivered, setIsDelivered] = useState<boolean>(false);
  const [successMsg, setSuccessMsg] = useState<string>('');
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Creación rápida y reabastecimiento rápido desde Pedidos
  const [showQuickAdd, setShowQuickAdd] = useState<boolean>(false);
  const [newProduct, setNewProduct] = useState<NewProductState>({ name: '', cost: '', price: '', stock: '', imagePreview: null });
  const [quickRestockProduct, setQuickRestockProduct] = useState<Product | null>(null);
  const [quickRestockFields, setQuickRestockFields] = useState({ quantity: '', unit_cost: '' });

  // Formulario agregar abono a pedido existente
  const [payingOrderId, setPayingOrderId] = useState<string | null>(null);
  const [addPaymentAmount, setAddPaymentAmount] = useState<string>('');

  const filteredProducts = useMemo<Product[]>(() => {
    const base = searchTerm
      ? products.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
      : [...products];
    return base.sort((a, b) => b.stock - a.stock);
  }, [searchTerm, products]);

  // Funciones de Carrito
  const handleAddToCart = (product: Product) => {
    const existing = cart.find(c => c.product.id === product.id);
    if (existing) {
      setCart(cart.map(c => c.product.id === product.id ? { ...c, quantity: c.quantity + 1 } : c));
    } else {
      setCart([...cart, { product, quantity: 1, salePrice: String(product.price || ''), saleCost: String(product.cost || '') }]);
    }
  };

  const handleCartQty = (productId: string, qty: number) => {
    if (qty <= 0) { setCart(cart.filter(c => c.product.id !== productId)); return; }
    setCart(cart.map(c => c.product.id === productId ? { ...c, quantity: qty } : c));
  };

  const handleCartPrice = (productId: string, val: string) => {
    setCart(cart.map(c => c.product.id === productId ? { ...c, salePrice: val } : c));
  };

  const cartTotal = cart.reduce((s, c) => s + (parseFloat(c.salePrice) || 0) * c.quantity, 0);

  // Funciones de Creación/Reabastecimiento Rápido
  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = await uploadImageToR2(file);
      newProduct.imagePreview = url;
      setNewProduct({ ...newProduct, imagePreview: url });
    } catch (err) { console.error(err); }
  };

  const handleQuickAdd = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!userId || !supabase) return;
    try {
      const { data } = await supabase.from('products').insert([{
        name: newProduct.name, 
        cost: parseFloat(newProduct.cost), 
        price: parseFloat(newProduct.price), 
        stock: parseInt(newProduct.stock), 
        image_url: newProduct.imagePreview,
        user_id: userId
      }]).select().throwOnError();
      if (data && data.length > 0) {
        const added: Product = { ...data[0], imageUrl: data[0].image_url };
        setCart(prev => [...prev, { product: added, quantity: 1, salePrice: String(added.price || ''), saleCost: String(added.cost || '') }]);
      }
      setShowQuickAdd(false); setSearchTerm('');
      setNewProduct({ name: '', cost: '', price: '', stock: '', imagePreview: null });
      onRefresh();
    } catch (err) { console.error(err); alert('Error agregando producto rápido.'); }
  };

  const handleQuickRestockSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!quickRestockProduct || !supabase || !userId) return;

    const qty = parseInt(quickRestockFields.quantity);
    const unitCost = parseFloat(quickRestockFields.unit_cost);
    if (!qty || isNaN(unitCost)) return;

    try {
      const currentStock = quickRestockProduct.stock;
      const currentCost = quickRestockProduct.avg_cost ?? quickRestockProduct.cost;
      const newAvgCost = currentStock + qty > 0
        ? ((currentStock * currentCost) + (qty * unitCost)) / (currentStock + qty)
        : unitCost;

      await supabase.from('restocks').insert([{
        product_id: quickRestockProduct.id,
        quantity: qty,
        unit_cost: unitCost,
        date: new Date().toISOString(),
        user_id: userId
      }]).throwOnError();

      await supabase.from('products').update({
        stock: currentStock + qty,
        cost: newAvgCost,
        avg_cost: newAvgCost
      }).eq('id', quickRestockProduct.id).eq('user_id', userId).throwOnError();

      const updatedProduct = { ...quickRestockProduct, stock: currentStock + qty, cost: newAvgCost, avg_cost: newAvgCost };

      setCart(prev => [...prev, { product: updatedProduct, quantity: 1, salePrice: String(updatedProduct.price || ''), saleCost: String(updatedProduct.cost || '') }]);
      setQuickRestockProduct(null);
      onRefresh();
    } catch (err) {
      console.error(err);
      alert("Error al reabastecer el producto rápido.");
    }
  };

  // Crear el pedido agrupado
  const handleCreateOrder = async () => {
    if (!cart.length || !userId || !supabase) return;
    
    try {
      const itemsToSave = cart.map(c => ({
        product_id: c.product.id,
        name: c.product.name,
        quantity: c.quantity,
        sale_price: parseFloat(c.salePrice),
        cost_at_sale: parseFloat(c.saleCost)
      }));

      await supabase.from('pending_orders').insert([{
        client_name: clientName.trim() || 'Cliente Anónimo',
        items: itemsToSave,
        total_price: cartTotal,
        amount_paid: parseFloat(orderPaid || '0'),
        is_delivered: isDelivered,
        date: new Date().toISOString(),
        user_id: userId
      }]).throwOnError();

      for (const item of cart) {
        await supabase.from('products')
          .update({ stock: item.product.stock - item.quantity })
          .eq('id', item.product.id)
          .eq('user_id', userId).throwOnError();
      }

      setShowAdd(false);
      setCart([]);
      setClientName('');
      setOrderPaid('0');
      setIsDelivered(false);
      onRefresh();
      setSuccessMsg('¡Pedido guardado y stock reservado!');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err) { console.error(err); alert('Error registrando el pedido.'); }
  };

  // Acciones en Pedidos Pendientes
  const handleToggleDelivered = async (order: PendingOrder) => {
    if (!supabase) return;
    try {
      await supabase.from('pending_orders').update({ is_delivered: !order.is_delivered }).eq('id', order.id).throwOnError();
      onRefresh();
    } catch (err) { console.error(err); }
  };

  const handleAddPayment = async (e: React.FormEvent<HTMLFormElement>, order: PendingOrder) => {
    e.preventDefault();
    if (!supabase || !addPaymentAmount) return;
    try {
      const newPaid = order.amount_paid + parseFloat(addPaymentAmount);
      await supabase.from('pending_orders').update({ amount_paid: newPaid }).eq('id', order.id).throwOnError();
      setPayingOrderId(null);
      setAddPaymentAmount('');
      onRefresh();
    } catch (err) { console.error(err); }
  };

  const handleCompleteOrder = async (order: PendingOrder) => {
    if (!userId || !supabase) return;
    try {
      const saleDate = new Date().toISOString(); // Se usa la misma fecha para agrupar
      for (const item of order.items) {
        await supabase.from('sales').insert([{
          product_id: item.product_id,
          sale_price: item.sale_price, 
          cost_at_sale: item.cost_at_sale, 
          quantity: item.quantity,
          date: saleDate,
          user_id: userId,
          client_name: order.client_name || 'Cliente Anónimo'
        }]).throwOnError();
      }

      await supabase.from('pending_orders').delete().eq('id', order.id).throwOnError();
      
      onRefresh();
      setSuccessMsg('¡Pedido finalizado y pasado a ventas!');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err) { console.error(err); alert('Error al completar pedido.'); }
  };

  const handleDeleteOrder = async (order: PendingOrder) => {
    if (!userId || !supabase) return;
    if (!confirm("¿Eliminar este pedido? El stock será devuelto al inventario.")) return;
    try {
      for (const item of order.items) {
        const product = products.find(p => p.id === item.product_id);
        if (product) {
          await supabase.from('products').update({ stock: product.stock + item.quantity }).eq('id', product.id).throwOnError();
        }
      }
      await supabase.from('pending_orders').delete().eq('id', order.id).throwOnError();
      onRefresh();
    } catch (err) { console.error(err); }
  };

  return (
    <div className="space-y-6 w-full relative">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-[1.75rem] font-medium text-[#111111] tracking-tight">Pedidos Pendientes</h2>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full sm:w-auto">
          <div className="flex bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1rem] p-1 flex-shrink-0">
            <button onClick={() => setViewMode('list')} className={`p-2 rounded-[0.75rem] transition-all touch-manipulation ${viewMode === 'list' ? 'bg-white shadow-sm border border-[#EAEAEC] text-[#111111]' : 'text-[#A1A1AA] hover:text-[#111111]'}`}><List size={18} /></button>
            <button onClick={() => setViewMode('grid')} className={`p-2 rounded-[0.75rem] transition-all touch-manipulation ${viewMode === 'grid' ? 'bg-white shadow-sm border border-[#EAEAEC] text-[#111111]' : 'text-[#A1A1AA] hover:text-[#111111]'}`}><LayoutGrid size={18} /></button>
          </div>
          <button onClick={() => setShowAdd(!showAdd)} className="bg-[#1A1A1A] hover:bg-black text-white px-6 py-3 sm:py-3 rounded-[1.25rem] flex items-center justify-center space-x-2 transition-all shadow-md shadow-black/10 active:scale-95 font-medium w-full sm:w-auto touch-manipulation"><Plus size={18} /><span>Nuevo Pedido</span></button>
        </div>
      </div>

      {successMsg && <div className="p-4 bg-[#E8F8B6]/50 text-[#4A6310] border border-[#C8F169]/40 rounded-[1.25rem] text-center font-medium animate-in fade-in slide-in-from-bottom-2">{successMsg}</div>}

      {showAdd && (
        <div className="bg-white rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-[#EAEAEC] p-4 md:p-8 w-full animate-in fade-in slide-in-from-top-4">
          {showQuickAdd ? (
            <form onSubmit={handleQuickAdd} className="grid grid-cols-1 md:grid-cols-5 gap-4 md:gap-5 items-end w-full">
              <div className="md:col-span-5 mb-2">
                <h3 className="text-xl font-medium text-[#111111] tracking-tight">Agregar Nuevo Producto Rápidamente</h3>
                <p className="text-sm text-[#71717A] font-medium mt-1">Regístralo rápido para meterlo al pedido.</p>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-[#71717A] mb-2">Nombre (Tipo de media)</label>
                <input type="text" required value={newProduct.name} onChange={e => setNewProduct({...newProduct, name: e.target.value})} className="w-full px-4 py-3 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" placeholder="Ej. Medias de compresión" />
                {/* ✨ SUGERIDOR DE NOMBRE */}
                <NameSuggester
                  imagePreview={newProduct.imagePreview}
                  currentName={newProduct.name}
                  existingNames={products.map(p => p.name)}
                  onSelect={(name) => setNewProduct({ ...newProduct, name })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#71717A] mb-2">Costo ($)</label>
                <input type="number" step="0.01" required value={newProduct.cost} onChange={e => setNewProduct({...newProduct, cost: e.target.value})} className="w-full px-4 py-3 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" placeholder="0.00" />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#71717A] mb-2">Precio Venta ($)</label>
                <input type="number" step="0.01" required value={newProduct.price} onChange={e => setNewProduct({...newProduct, price: e.target.value})} className="w-full px-4 py-3 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" placeholder="0.00" />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#71717A] mb-2">Stock Inicial</label>
                <input type="number" required value={newProduct.stock} onChange={e => setNewProduct({...newProduct, stock: e.target.value})} className="w-full px-4 py-3 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" placeholder="0" />
              </div>
              <div className="md:col-span-5">
                <label className="block text-sm font-medium text-[#71717A] mb-2">Fotografía del Producto (Opcional)</label>
                <input type="file" accept="image/*" onChange={handleImageChange} className="w-full px-4 py-3 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" />
              </div>
              <div className="md:col-span-5 flex flex-col sm:flex-row justify-end mt-4 pt-6 border-t border-[#EAEAEC]/60 gap-3">
                <button type="button" onClick={() => setShowQuickAdd(false)} className="w-full sm:w-auto px-6 py-3 text-[#71717A] hover:text-[#111111] bg-[#F4F5F4] hover:bg-[#EAEAEC] rounded-[1.25rem] font-medium transition-colors touch-manipulation">Cancelar</button>
                <button type="submit" className="w-full sm:w-auto bg-[#1A1A1A] hover:bg-black text-white px-8 py-3 rounded-[1.25rem] transition-all font-medium shadow-md shadow-black/10 active:scale-95 touch-manipulation">Guardar y Continuar</button>
              </div>
            </form>
          ) : (
            <>
              {/* Búsqueda */}
              <div className="relative w-full mb-5">
                <label className="block text-sm font-medium text-[#71717A] mb-3">Buscar Producto para el Pedido</label>
                <div className="relative">
                  <Search className="absolute left-4 top-4 text-[#A1A1AA]" size={20} />
                  <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-12 pr-4 py-3.5 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" placeholder="Ej. Medias Nike..." autoFocus />
                </div>
              </div>

              {/* Carrito activo del Pedido */}
              {cart.length > 0 && (
                <div className="mb-5 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.5rem] p-4 space-y-3 animate-in fade-in">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Pedido actual — {cart.length} producto{cart.length > 1 ? 's' : ''}</p>
                  {cart.map(item => (
                    <div key={item.product.id} className="bg-white border border-[#EAEAEC] rounded-[1.25rem] px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {item.product.imageUrl && <img src={item.product.imageUrl} alt={item.product.name} className="w-10 h-10 rounded-[0.75rem] object-cover border border-[#EAEAEC] flex-shrink-0" />}
                        <span className="font-medium text-[#111111] text-sm truncate">{item.product.name}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                        <div className="flex items-center gap-1 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[0.75rem] px-1">
                          <button type="button" onClick={() => handleCartQty(item.product.id, item.quantity - 1)} className="w-7 h-7 flex items-center justify-center text-[#71717A] hover:text-[#111111] font-bold touch-manipulation">−</button>
                          <span className="w-6 text-center text-sm font-medium text-[#111111]">{item.quantity}</span>
                          <button type="button" onClick={() => handleCartQty(item.product.id, item.quantity + 1)} disabled={item.quantity >= item.product.stock} className="w-7 h-7 flex items-center justify-center text-[#71717A] hover:text-[#111111] font-bold touch-manipulation disabled:opacity-30">+</button>
                        </div>
                        <div className="relative">
                          <DollarSign className="absolute left-2.5 top-2.5 text-[#A1A1AA]" size={13} />
                          <input type="number" step="0.01" value={item.salePrice} onChange={e => handleCartPrice(item.product.id, e.target.value)} className="w-20 pl-7 pr-2 py-2 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[0.75rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] outline-none text-sm" placeholder="0.00" />
                        </div>
                        <button type="button" onClick={() => setCart(cart.filter(c => c.product.id !== item.product.id))} className="p-1.5 rounded-[0.5rem] text-[#A1A1AA] hover:text-red-500 hover:bg-red-50 transition-colors touch-manipulation"><X size={14} /></button>
                      </div>
                    </div>
                  ))}
                  
                  {/* Total y Formulario del Cliente */}
                  <div className="flex flex-col gap-4 pt-4 border-t border-[#EAEAEC]/60 mt-4">
                    <div className="flex gap-4 items-center">
                      <div className="text-left"><p className="text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Total Pedido</p><p className="text-xl font-bold text-[#111111] tracking-tight">${cartTotal.toFixed(2)}</p></div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-[#EAEAEC]/60">
                      <div className="md:col-span-1">
                        <label className="block text-sm font-medium text-[#71717A] mb-2">Cliente / Contacto</label>
                        <input type="text" value={clientName} onChange={e => setClientName(e.target.value)} className="w-full px-4 py-3 bg-white border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] outline-none text-sm" placeholder="Ej. Juan Pérez (Opcional)" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[#71717A] mb-2">Abono Inicial ($)</label>
                        <div className="relative"><DollarSign className="absolute left-3 top-3.5 text-[#A1A1AA]" size={16} /><input type="number" step="0.01" required value={orderPaid} onChange={e => setOrderPaid(e.target.value)} className="w-full pl-9 pr-4 py-3 bg-white border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] outline-none text-sm" /></div>
                      </div>
                      <div className="flex items-end pb-3">
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input type="checkbox" checked={isDelivered} onChange={e => setIsDelivered(e.target.checked)} className="w-5 h-5 accent-[#C8F169] rounded border-[#EAEAEC]" />
                          <span className="text-sm font-medium text-[#111111]">Ya entregado</span>
                        </label>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row justify-end gap-3 mt-2">
                      <button type="button" onClick={() => {setCart([]); setShowAdd(false);}} className="w-full sm:w-auto px-6 py-3 text-[#71717A] bg-white border border-[#EAEAEC] hover:bg-[#F4F5F4] rounded-[1.25rem] font-medium transition-colors">Cancelar</button>
                      <button type="button" onClick={() => handleCreateOrder()} disabled={cart.some(c => !c.salePrice || parseFloat(c.salePrice) <= 0)} className="w-full sm:w-auto bg-[#1A1A1A] hover:bg-black text-white px-8 py-3 rounded-[1.25rem] transition-all font-medium active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">Guardar Pedido Pendiente</button>
                    </div>
                  </div>

                </div>
              )}

              {/* Grid de productos */}
              {filteredProducts.length > 0 ? (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] mb-3">{searchTerm ? 'Resultados' : 'Todos los productos — toca para agregar al pedido'}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {filteredProducts.map(p => {
                      const inCart = cart.find(c => c.product.id === p.id);
                      return (
                        <button 
                          key={p.id} 
                          type="button" 
                          onClick={() => {
                            if (p.stock === 0) {
                              setQuickRestockProduct(p);
                              setQuickRestockFields({ quantity: '1', unit_cost: String((p.avg_cost ?? p.cost) || '') });
                            } else {
                              handleAddToCart(p);
                            }
                          }} 
                          className={`relative flex flex-col items-start text-left bg-[#F9FAFA] border-2 rounded-[1.25rem] p-3 transition-all touch-manipulation active:scale-95 ${inCart ? 'border-[#C8F169] bg-[#E8F8B6]/20' : 'border-[#EAEAEC] hover:border-[#C8F169]/50 hover:bg-white'} ${p.stock === 0 ? 'opacity-60 cursor-pointer border-dashed hover:border-[#C8F169]/80' : 'cursor-pointer'}`}
                        >
                          {p.imageUrl && <img src={p.imageUrl} alt={p.name} className="w-full h-20 object-cover rounded-[0.75rem] mb-2 border border-[#EAEAEC]" />}
                          {!p.imageUrl && <div className="w-full h-20 bg-[#EAEAEC] rounded-[0.75rem] mb-2 flex items-center justify-center"><Package size={20} className="text-[#A1A1AA]" /></div>}
                          <p className="text-xs font-medium text-[#111111] leading-tight line-clamp-2 mb-1">{p.name}</p>
                          <p className="text-xs font-bold text-[#111111]">${(p.price || 0).toFixed(2)}</p>
                          <span className={`mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${p.stock > 10 ? 'bg-[#E8F8B6]/50 text-[#4A6310]' : p.stock > 0 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'}`}>{p.stock === 0 ? 'Sin stock' : `${p.stock} uds.`}</span>
                          {inCart && <div className="absolute top-2 right-2 w-5 h-5 bg-[#C8F169] rounded-full flex items-center justify-center text-[10px] font-bold text-[#1A1A1A]">{inCart.quantity}</div>}
                        </button>
                      );
                    })}
                  </div>
                  {!searchTerm && (
                    <button type="button" onClick={() => setShowQuickAdd(true)} className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-[#EAEAEC] hover:border-[#C8F169] rounded-[1.25rem] text-sm font-medium text-[#71717A] hover:text-[#111111] transition-all touch-manipulation">
                      <Plus size={16} /><span>Agregar nuevo producto al inventario</span>
                    </button>
                  )}
                </div>
              ) : searchTerm ? (
                <div className="text-center py-8 flex flex-col items-center">
                  <p className="text-[#71717A] font-medium mb-4">No se encontraron productos en el inventario.</p>
                  <button onClick={() => {setNewProduct({ name: searchTerm, cost: '', price: '', stock: '', imagePreview: null }); setShowQuickAdd(true);}} className="bg-[#C8F169] text-[#1A1A1A] hover:bg-[#b8e354] px-6 py-3.5 rounded-[1.25rem] text-sm font-medium transition-all inline-flex items-center space-x-2 active:scale-95 touch-manipulation">
                    <Plus size={18} /><span>Agregar "{searchTerm}" al Inventario</span>
                  </button>
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-[#71717A] font-medium mb-4">No hay productos en el inventario.</p>
                  <button onClick={() => setShowQuickAdd(true)} className="bg-[#C8F169] text-[#1A1A1A] hover:bg-[#b8e354] px-6 py-3.5 rounded-[1.25rem] text-sm font-medium transition-all inline-flex items-center space-x-2 active:scale-95 touch-manipulation"><Plus size={18} /><span>Agregar primer producto</span></button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* --- MODAL REABASTECIMIENTO RÁPIDO DESDE PEDIDOS --- */}
      {quickRestockProduct && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm animate-in fade-in" onClick={() => setQuickRestockProduct(null)}>
          <div className="bg-white rounded-[2rem] shadow-[0_24px_60px_rgba(0,0,0,0.12)] border border-[#EAEAEC] w-full max-w-md p-6 md:p-8 animate-in slide-in-from-bottom-4" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-medium text-[#111111] tracking-tight">Reabastecer para Pedido</h3>
              <button onClick={() => setQuickRestockProduct(null)} className="p-2 rounded-[0.75rem] text-[#A1A1AA] hover:text-[#111111] hover:bg-[#EAEAEC] transition-colors touch-manipulation"><X size={18} /></button>
            </div>
            <p className="text-sm text-[#71717A] mb-5 font-medium">El producto <strong className="text-[#111111]">{quickRestockProduct.name}</strong> no tiene stock. Ingresa las unidades que acaban de llegar para agregarlas y meterlas al pedido.</p>
            
            <form onSubmit={handleQuickRestockSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#71717A] mb-2">Unidades nuevas</label>
                  <input type="number" min="1" required value={quickRestockFields.quantity} onChange={e => setQuickRestockFields({...quickRestockFields, quantity: e.target.value})} className="w-full px-4 py-3 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" placeholder="Ej. 10" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#71717A] mb-2">Costo por ud. ($)</label>
                  <div className="relative"><DollarSign className="absolute left-3 top-3.5 text-[#A1A1AA]" size={18} /><input type="number" step="0.01" min="0" required value={quickRestockFields.unit_cost} onChange={e => setQuickRestockFields({...quickRestockFields, unit_cost: e.target.value})} className="w-full pl-9 pr-4 py-3 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" placeholder="0.00" /></div>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row justify-end gap-3 pt-4 border-t border-[#EAEAEC]/60">
                <button type="button" onClick={() => setQuickRestockProduct(null)} className="w-full sm:w-auto px-6 py-3 text-[#71717A] hover:text-[#111111] bg-[#F4F5F4] hover:bg-[#EAEAEC] rounded-[1.25rem] font-medium transition-colors touch-manipulation">Cancelar</button>
                <button type="submit" className="w-full sm:w-auto bg-[#1A1A1A] hover:bg-black text-white px-6 py-3 rounded-[1.25rem] transition-all font-medium shadow-md shadow-black/10 active:scale-95 touch-manipulation flex items-center justify-center gap-2"><RefreshCw size={16}/><span>Agregar al Pedido</span></button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Grid vs List de pedidos pendientes */}
      {pendingOrders.length === 0 && !showAdd ? (
        <div className="col-span-full text-center py-10 text-[#71717A] font-medium">No tienes pedidos pendientes.</div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 w-full animate-in fade-in">
          {pendingOrders.map(order => {
            const balance = order.total_price - order.amount_paid;
            const isFullyPaid = balance <= 0;
            const readyToComplete = isFullyPaid && order.is_delivered;

            return (
              <div key={order.id} className="bg-white p-5 rounded-[2rem] shadow-[0_4px_24px_rgba(0,0,0,0.02)] border border-[#EAEAEC] flex flex-col h-full">
                <div className="flex justify-between items-start mb-4 gap-2">
                  <div>
                    <h3 className="font-medium text-[#111111] text-lg leading-tight tracking-tight">{order.client_name}</h3>
                    <p className="text-xs text-[#71717A] mt-1">{new Date(order.date).toLocaleDateString()}</p>
                  </div>
                  <div className="flex flex-col gap-1 items-end">
                    <span className={`px-2 py-1 text-[10px] font-bold uppercase tracking-widest rounded-full flex-shrink-0 ${isFullyPaid ? 'bg-[#E8F8B6]/50 text-[#4A6310]' : 'bg-red-50 text-red-600'}`}>{isFullyPaid ? 'Pagado' : `Debe $${balance.toFixed(2)}`}</span>
                    <span className={`px-2 py-1 text-[10px] font-bold uppercase tracking-widest rounded-full flex-shrink-0 ${order.is_delivered ? 'bg-[#E8F8B6]/50 text-[#4A6310]' : 'bg-amber-50 text-amber-700'}`}>{order.is_delivered ? 'Entregado' : 'Por Entregar'}</span>
                  </div>
                </div>
                
                <div className="bg-[#F9FAFA] p-3 rounded-[1rem] border border-[#EAEAEC] mb-4 space-y-2">
                  {order.items && order.items.map((item, idx) => {
                    const product = products.find(p => p.id === item.product_id);
                    return (
                      <div key={idx} className="flex items-center gap-3">
                        {product?.imageUrl ? (
                          <img 
                            src={product.imageUrl} 
                            alt={item.name} 
                            className="w-8 h-8 rounded-[0.5rem] object-cover border border-[#EAEAEC] flex-shrink-0 cursor-pointer" 
                            onClick={(e) => { e.stopPropagation(); setLightboxUrl(product.imageUrl!); }}
                          />
                        ) : (
                          <div className="w-8 h-8 bg-[#EAEAEC] rounded-[0.5rem] flex items-center justify-center flex-shrink-0"><Package size={14} className="text-[#A1A1AA]" /></div>
                        )}
                        <p className="text-sm font-medium text-[#111111]">{item.quantity}x {item.name}</p>
                      </div>
                    );
                  })}
                  <div className="flex justify-between pt-2 border-t border-[#EAEAEC] mt-2 text-xs font-medium text-[#71717A]">
                    <span>Total: <strong className="text-[#111111]">${order.total_price.toFixed(2)}</strong></span>
                    <span>Abonado: <strong className="text-[#111111]">${order.amount_paid.toFixed(2)}</strong></span>
                  </div>
                </div>

                <div className="mt-auto pt-4 border-t border-[#EAEAEC]/60 space-y-3">
                  {payingOrderId === order.id ? (
                    <form onSubmit={(e) => handleAddPayment(e, order)} className="flex gap-2">
                      <input type="number" step="0.01" max={balance} required value={addPaymentAmount} onChange={e => setAddPaymentAmount(e.target.value)} className="flex-1 px-3 py-2 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[0.75rem] text-sm outline-none focus:border-[#C8F169]" placeholder={`Máx: $${balance.toFixed(2)}`} />
                      <button type="button" onClick={() => setPayingOrderId(null)} className="px-3 py-2 text-xs font-medium text-[#71717A] bg-white border border-[#EAEAEC] rounded-[0.75rem]">X</button>
                      <button type="submit" className="px-3 py-2 text-xs font-medium text-[#111111] bg-[#C8F169] rounded-[0.75rem]">Abonar</button>
                    </form>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {!isFullyPaid && <button onClick={() => setPayingOrderId(order.id)} className="px-4 py-2 bg-white border border-[#EAEAEC] hover:border-[#C8F169] text-sm font-medium text-[#111111] rounded-[1rem] transition-colors touch-manipulation flex-1 text-center">Registrar Abono</button>}
                      {!order.is_delivered && <button onClick={() => handleToggleDelivered(order)} className="px-4 py-2 bg-white border border-[#EAEAEC] hover:border-[#C8F169] text-sm font-medium text-[#111111] rounded-[1rem] transition-colors touch-manipulation flex-1 text-center">Marcar Entregado</button>}
                    </div>
                  )}

                  {readyToComplete ? (
                    <button onClick={() => handleCompleteOrder(order)} className="w-full flex items-center justify-center gap-2 bg-[#1A1A1A] hover:bg-black text-white px-4 py-3 rounded-[1rem] text-sm font-medium transition-all active:scale-95 touch-manipulation"><CheckCircle size={16} /><span>Finalizar y pasar a Ventas</span></button>
                  ) : (
                    <button onClick={() => handleDeleteOrder(order)} className="w-full text-center text-xs font-medium text-red-500 hover:text-red-700 py-1 touch-manipulation">Cancelar pedido (devuelve stock)</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-[#EAEAEC] overflow-hidden w-full animate-in fade-in">
          <div className="overflow-x-auto w-full" style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr className="bg-white text-[#A1A1AA] text-[11px] font-bold uppercase tracking-widest border-b border-[#EAEAEC]">
                  <th className="px-4 md:px-6 py-4 md:py-5">Cliente / Fecha</th>
                  <th className="px-4 md:px-6 py-4 md:py-5">Artículos</th>
                  <th className="px-4 md:px-6 py-4 md:py-5">Finanzas</th>
                  <th className="px-4 md:px-6 py-4 md:py-5">Estado</th>
                  <th className="px-4 md:px-6 py-4 md:py-5 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAEAEC]/60">
                {pendingOrders.map(order => {
                  const balance = order.total_price - order.amount_paid;
                  const isFullyPaid = balance <= 0;
                  const readyToComplete = isFullyPaid && order.is_delivered;
                  return (
                    <tr key={order.id} className="hover:bg-[#F9FAFA] transition-colors group align-top">
                      <td className="px-4 md:px-6 py-4 md:py-5">
                        <p className="font-medium text-[#111111] text-base leading-tight">{order.client_name}</p>
                        <p className="text-xs text-[#71717A] mt-1">{new Date(order.date).toLocaleDateString()}</p>
                      </td>
                      <td className="px-4 md:px-6 py-4 md:py-5">
                        <div className="space-y-2">
                          {order.items && order.items.map((item, idx) => {
                            const product = products.find(p => p.id === item.product_id);
                            return (
                              <div key={idx} className="flex items-center gap-3">
                                {product?.imageUrl ? (
                                  <img 
                                    src={product.imageUrl} 
                                    alt={item.name} 
                                    className="w-8 h-8 rounded-[0.5rem] object-cover border border-[#EAEAEC] flex-shrink-0 cursor-pointer" 
                                    onClick={(e) => { e.stopPropagation(); setLightboxUrl(product.imageUrl!); }}
                                  />
                                ) : (
                                  <div className="w-8 h-8 bg-[#EAEAEC] rounded-[0.5rem] flex items-center justify-center flex-shrink-0"><Package size={14} className="text-[#A1A1AA]" /></div>
                                )}
                                <p className="text-sm font-medium text-[#111111]">{item.quantity}x {item.name}</p>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-4 md:px-6 py-4 md:py-5 space-y-1">
                         <p className="text-xs font-medium text-[#71717A]">Total: <strong className="text-[#111111]">${order.total_price.toFixed(2)}</strong></p>
                         <p className="text-xs font-medium text-[#71717A]">Abonado: <strong className="text-[#111111]">${order.amount_paid.toFixed(2)}</strong></p>
                      </td>
                      <td className="px-4 md:px-6 py-4 md:py-5">
                        <div className="flex flex-col gap-1.5 items-start">
                          <span className={`px-2 py-1 text-[10px] font-bold uppercase tracking-widest rounded-full flex-shrink-0 ${isFullyPaid ? 'bg-[#E8F8B6]/50 text-[#4A6310]' : 'bg-red-50 text-red-600'}`}>{isFullyPaid ? 'Pagado' : `Debe $${balance.toFixed(2)}`}</span>
                          <span className={`px-2 py-1 text-[10px] font-bold uppercase tracking-widest rounded-full flex-shrink-0 ${order.is_delivered ? 'bg-[#E8F8B6]/50 text-[#4A6310]' : 'bg-amber-50 text-amber-700'}`}>{order.is_delivered ? 'Entregado' : 'Por Entregar'}</span>
                        </div>
                      </td>
                      <td className="px-4 md:px-6 py-4 md:py-5">
                        <div className="flex flex-col gap-2 min-w-[200px] items-end ml-auto">
                           {payingOrderId === order.id ? (
                              <form onSubmit={(e) => handleAddPayment(e, order)} className="flex gap-2 w-full">
                                <input type="number" step="0.01" max={balance} required value={addPaymentAmount} onChange={e => setAddPaymentAmount(e.target.value)} className="flex-1 px-3 py-2 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[0.75rem] text-sm outline-none focus:border-[#C8F169] min-w-0" placeholder={`Máx: $${balance.toFixed(2)}`} />
                                <button type="button" onClick={() => setPayingOrderId(null)} className="px-3 py-2 text-xs font-medium text-[#71717A] bg-white border border-[#EAEAEC] rounded-[0.75rem]">X</button>
                                <button type="submit" className="px-3 py-2 text-xs font-medium text-[#111111] bg-[#C8F169] rounded-[0.75rem]">Abonar</button>
                              </form>
                            ) : (
                              <div className="flex flex-col gap-2 w-full">
                                <div className="flex gap-2 w-full">
                                  {!isFullyPaid && <button onClick={() => setPayingOrderId(order.id)} className="px-3 py-2 bg-white border border-[#EAEAEC] hover:border-[#C8F169] text-xs font-medium text-[#111111] rounded-[0.75rem] transition-colors touch-manipulation flex-1 text-center">Registrar Abono</button>}
                                  {!order.is_delivered && <button onClick={() => handleToggleDelivered(order)} className="px-3 py-2 bg-white border border-[#EAEAEC] hover:border-[#C8F169] text-xs font-medium text-[#111111] rounded-[0.75rem] transition-colors touch-manipulation flex-1 text-center">Marcar Entregado</button>}
                                </div>
                                {readyToComplete ? (
                                  <button onClick={() => handleCompleteOrder(order)} className="w-full flex items-center justify-center gap-1.5 bg-[#1A1A1A] hover:bg-black text-white px-3 py-2 rounded-[0.75rem] text-xs font-medium transition-all active:scale-95 touch-manipulation"><CheckCircle size={14} /><span>Finalizar y pasar a Ventas</span></button>
                                ) : (
                                  <button onClick={() => handleDeleteOrder(order)} className="w-full text-center text-[11px] font-medium text-red-500 hover:text-red-700 py-1 touch-manipulation">Cancelar pedido (devuelve stock)</button>
                                )}
                              </div>
                            )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- Lightbox Global para Pedidos --- */}
      {lightboxUrl && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in" onClick={() => setLightboxUrl(null)}>
          <button className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors touch-manipulation"><X size={22} /></button>
          <img src={lightboxUrl} alt="Imagen ampliada" className="max-w-[92vw] max-h-[88vh] rounded-[1.5rem] shadow-2xl object-contain animate-in zoom-in-90" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

// --- VISTAS ANTERIORES (VENTAS, DASHBOARD INTACTAS) ---

function RecordSaleView({ products, userId, onRefresh }: { products: Product[]; userId?: string; onRefresh: () => void }) {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [saleCost, setSaleCost] = useState<string>(''); 
  const [salePrice, setSalePrice] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(1);
  const [clientName, setClientName] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');
  const [showQuickAdd, setShowQuickAdd] = useState<boolean>(false);
  const [newProduct, setNewProduct] = useState<NewProductState>({ name: '', cost: '', price: '', stock: '', imagePreview: null });

  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartSuccess, setCartSuccess] = useState('');

  const [quickRestockProduct, setQuickRestockProduct] = useState<Product | null>(null);
  const [quickRestockFields, setQuickRestockFields] = useState({ quantity: '', unit_cost: '' });

  const filteredProducts = useMemo<Product[]>(() => {
    const base = searchTerm
      ? products.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
      : [...products];
    return base.sort((a, b) => b.stock - a.stock);
  }, [searchTerm, products]);

  const handleSelectProduct = (product: Product) => {
    setSelectedProduct(product);
    setSearchTerm('');
    setSaleCost(String(product.cost)); 
    setSalePrice(String(product.price || '')); 
  };

  const handleRecordSale = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedProduct || !salePrice || !saleCost || quantity <= 0 || !userId || !supabase) return;
    try {
      await supabase.from('sales').insert([{
        product_id: selectedProduct.id,
        sale_price: parseFloat(salePrice),
        cost_at_sale: parseFloat(saleCost), 
        quantity: parseInt(String(quantity)),
        date: new Date().toISOString(),
        user_id: userId,
        client_name: clientName.trim() || 'Cliente Anónimo'
      }]).throwOnError();
      await supabase.from('products')
        .update({ stock: selectedProduct.stock - parseInt(String(quantity)) })
        .eq('id', selectedProduct.id)
        .eq('user_id', userId).throwOnError();
      setSelectedProduct(null); setSalePrice(''); setQuantity(1); setClientName(''); onRefresh(); setSuccessMsg('¡Venta registrada con éxito!');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err) { console.error(err); alert('Error registrando venta. Revisa la consola.'); }
  };

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = await uploadImageToR2(file);
      setNewProduct({ ...newProduct, imagePreview: url });
    } catch (err) { console.error(err); }
  };

  const handleQuickAdd = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!userId || !supabase) return;
    try {
      const { data } = await supabase.from('products').insert([{
        name: newProduct.name, 
        cost: parseFloat(newProduct.cost), 
        price: parseFloat(newProduct.price), 
        stock: parseInt(newProduct.stock), 
        image_url: newProduct.imagePreview,
        user_id: userId
      }]).select().throwOnError();
      if (data && data.length > 0) {
        const added: Product = { ...data[0], imageUrl: data[0].image_url };
        setCart(prev => [...prev, { product: added, quantity: 1, salePrice: String(added.price || ''), saleCost: String(added.cost || '') }]);
      }
      setShowQuickAdd(false); setSearchTerm('');
      setNewProduct({ name: '', cost: '', price: '', stock: '', imagePreview: null });
      onRefresh();
    } catch (err) { console.error(err); alert('Error agregando producto rápido.'); }
  };

  const handleAddToCart = (product: Product) => {
    const existing = cart.find(c => c.product.id === product.id);
    if (existing) {
      setCart(cart.map(c => c.product.id === product.id ? { ...c, quantity: c.quantity + 1 } : c));
    } else {
      setCart([...cart, { product, quantity: 1, salePrice: String(product.price || ''), saleCost: String(product.cost || '') }]);
    }
  };

  const handleCartQty = (productId: string, qty: number) => {
    if (qty <= 0) { setCart(cart.filter(c => c.product.id !== productId)); return; }
    setCart(cart.map(c => c.product.id === productId ? { ...c, quantity: qty } : c));
  };

  const handleCartPrice = (productId: string, val: string) => {
    setCart(cart.map(c => c.product.id === productId ? { ...c, salePrice: val } : c));
  };

  const handleCartCost = (productId: string, val: string) => {
    setCart(cart.map(c => c.product.id === productId ? { ...c, saleCost: val } : c));
  };

  const cartTotal = cart.reduce((s, c) => s + (parseFloat(c.salePrice) || 0) * c.quantity, 0);
  const cartProfit = cart.reduce((s, c) => s + ((parseFloat(c.salePrice) || 0) - (parseFloat(c.saleCost) || 0)) * c.quantity, 0);

  const handleConfirmCart = async () => {
    if (!cart.length || !userId || !supabase) return;
    try {
      const saleDate = new Date().toISOString();
      for (const item of cart) {
        await supabase.from('sales').insert([{
          product_id: item.product.id,
          sale_price: parseFloat(item.salePrice),
          cost_at_sale: parseFloat(item.saleCost),
          quantity: item.quantity,
          date: saleDate,
          user_id: userId,
          client_name: clientName.trim() || 'Cliente Anónimo'
        }]).throwOnError();
        await supabase.from('products')
          .update({ stock: item.product.stock - item.quantity })
          .eq('id', item.product.id).eq('user_id', userId).throwOnError();
      }
      setCart([]);
      setClientName('');
      onRefresh();
      setCartSuccess(`¡${cart.length > 1 ? cart.length + ' productos vendidos' : '1 producto vendido'} con éxito!`);
      setTimeout(() => setCartSuccess(''), 3000);
    } catch (err) { console.error(err); alert('Error confirmando carrito.'); }
  };

  const handleQuickRestockSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!quickRestockProduct || !supabase || !userId) return;

    const qty = parseInt(quickRestockFields.quantity);
    const unitCost = parseFloat(quickRestockFields.unit_cost);
    if (!qty || isNaN(unitCost)) return;

    try {
      const currentStock = quickRestockProduct.stock;
      const currentCost = quickRestockProduct.avg_cost ?? quickRestockProduct.cost;
      const newAvgCost = currentStock + qty > 0
        ? ((currentStock * currentCost) + (qty * unitCost)) / (currentStock + qty)
        : unitCost;

      await supabase.from('restocks').insert([{
        product_id: quickRestockProduct.id,
        quantity: qty,
        unit_cost: unitCost,
        date: new Date().toISOString(),
        user_id: userId
      }]).throwOnError();

      await supabase.from('products').update({
        stock: currentStock + qty,
        cost: newAvgCost,
        avg_cost: newAvgCost
      }).eq('id', quickRestockProduct.id).eq('user_id', userId).throwOnError();

      const updatedProduct = { ...quickRestockProduct, stock: currentStock + qty, cost: newAvgCost, avg_cost: newAvgCost };

      setCart(prev => [...prev, { product: updatedProduct, quantity: 1, salePrice: String(updatedProduct.price || ''), saleCost: String(updatedProduct.cost || '') }]);

      setQuickRestockProduct(null);
      onRefresh();
      setSuccessMsg(`¡${updatedProduct.name} reabastecido y agregado a la orden!`);
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      console.error(err);
      alert("Error al reabastecer el producto rápido.");
    }
  };

  return (
    <div className="max-w-3xl mx-auto w-full relative">
      <h2 className="text-[1.75rem] font-medium mb-6 text-[#111111] tracking-tight">Registrar Nueva Venta</h2>
      <div className="bg-white rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-[#EAEAEC] p-4 md:p-8 w-full">
        {showQuickAdd ? (
          <form onSubmit={handleQuickAdd} className="grid grid-cols-1 md:grid-cols-5 gap-4 md:gap-5 items-end animate-in fade-in slide-in-from-top-4 w-full">
            <div className="md:col-span-5 mb-2">
              <h3 className="text-xl font-medium text-[#111111] tracking-tight">Agregar Nuevo Producto Rápidamente</h3>
              <p className="text-sm text-[#71717A] font-medium mt-1">Regístralo rápido al inventario para venderlo ahora mismo.</p>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-[#71717A] mb-2">Nombre (Tipo de media)</label>
              <input type="text" required value={newProduct.name} onChange={e => setNewProduct({...newProduct, name: e.target.value})} className="w-full px-4 py-3 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" placeholder="Ej. Medias de compresión" />
              {/* ✨ SUGERIDOR DE NOMBRE */}
              <NameSuggester
                imagePreview={newProduct.imagePreview}
                currentName={newProduct.name}
                existingNames={products.map(p => p.name)}
                onSelect={(name) => setNewProduct({ ...newProduct, name })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#71717A] mb-2">Costo ($)</label>
              <input type="number" step="0.01" required value={newProduct.cost} onChange={e => setNewProduct({...newProduct, cost: e.target.value})} className="w-full px-4 py-3 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" placeholder="0.00" />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#71717A] mb-2">Precio Venta ($)</label>
              <input type="number" step="0.01" required value={newProduct.price} onChange={e => setNewProduct({...newProduct, price: e.target.value})} className="w-full px-4 py-3 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" placeholder="0.00" />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#71717A] mb-2">Stock Inicial</label>
              <input type="number" required value={newProduct.stock} onChange={e => setNewProduct({...newProduct, stock: e.target.value})} className="w-full px-4 py-3 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" placeholder="0" />
            </div>
            <div className="md:col-span-5">
              <label className="block text-sm font-medium text-[#71717A] mb-2">Fotografía del Producto (Opcional)</label>
              <input type="file" accept="image/*" onChange={handleImageChange} className="w-full px-4 py-3 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" />
            </div>
            <div className="md:col-span-5 flex flex-col sm:flex-row justify-end mt-4 pt-6 border-t border-[#EAEAEC]/60 gap-3">
              <button type="button" onClick={() => setShowQuickAdd(false)} className="w-full sm:w-auto px-6 py-3 sm:py-3 text-[#71717A] hover:text-[#111111] bg-[#F4F5F4] hover:bg-[#EAEAEC] rounded-[1.25rem] font-medium transition-colors touch-manipulation">Cancelar</button>
              <button type="submit" className="w-full sm:w-auto bg-[#1A1A1A] hover:bg-black text-white px-8 py-3 sm:py-3 rounded-[1.25rem] transition-all font-medium shadow-md shadow-black/10 active:scale-95 touch-manipulation">Guardar y Continuar</button>
            </div>
          </form>
        ) : !selectedProduct ? (
          <>
            {/* Búsqueda */}
            <div className="relative w-full mb-5">
              <label className="block text-sm font-medium text-[#71717A] mb-3">Buscar Producto (escribe el nombre)</label>
              <div className="relative">
                <Search className="absolute left-4 top-4 text-[#A1A1AA]" size={20} />
                <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-12 pr-4 py-3.5 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" placeholder="Ej. Medias Nike..." autoFocus />
              </div>
            </div>

            {/* Carrito activo */}
            {cart.length > 0 && (
              <div className="mb-5 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.5rem] p-4 space-y-3 animate-in fade-in">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Orden actual — {cart.length} producto{cart.length > 1 ? 's' : ''}</p>
                {cart.map(item => (
                  <div key={item.product.id} className="bg-white border border-[#EAEAEC] rounded-[1.25rem] px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {item.product.imageUrl && <img src={item.product.imageUrl} alt={item.product.name} className="w-10 h-10 rounded-[0.75rem] object-cover border border-[#EAEAEC] flex-shrink-0" />}
                      <span className="font-medium text-[#111111] text-sm truncate">{item.product.name}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                      <div className="flex items-center gap-1 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[0.75rem] px-1">
                        <button type="button" onClick={() => handleCartQty(item.product.id, item.quantity - 1)} className="w-7 h-7 flex items-center justify-center text-[#71717A] hover:text-[#111111] font-bold touch-manipulation">−</button>
                        <span className="w-6 text-center text-sm font-medium text-[#111111]">{item.quantity}</span>
                        <button type="button" onClick={() => handleCartQty(item.product.id, item.quantity + 1)} disabled={item.quantity >= item.product.stock} className="w-7 h-7 flex items-center justify-center text-[#71717A] hover:text-[#111111] font-bold touch-manipulation disabled:opacity-30">+</button>
                      </div>
                      <div className="relative">
                        <DollarSign className="absolute left-2.5 top-2.5 text-[#A1A1AA]" size={13} />
                        <input type="number" step="0.01" value={item.salePrice} onChange={e => handleCartPrice(item.product.id, e.target.value)} className="w-20 pl-7 pr-2 py-2 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[0.75rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] outline-none text-sm" placeholder="0.00" />
                      </div>
                      {item.salePrice && item.saleCost && (
                        <span className={`text-xs font-bold px-2 py-1 rounded-full ${(parseFloat(item.salePrice) - parseFloat(item.saleCost)) > 0 ? 'bg-[#E8F8B6]/50 text-[#4A6310]' : 'bg-red-50 text-red-600'}`}>
                          +${((parseFloat(item.salePrice) - parseFloat(item.saleCost)) * item.quantity).toFixed(2)}
                        </span>
                      )}
                      <button type="button" onClick={() => setCart(cart.filter(c => c.product.id !== item.product.id))} className="p-1.5 rounded-[0.5rem] text-[#A1A1AA] hover:text-red-500 hover:bg-red-50 transition-colors touch-manipulation"><X size={14} /></button>
                    </div>
                  </div>
                ))}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-[#EAEAEC]/60 mt-2">
                  <div className="flex gap-4 items-center">
                    <div className="text-center"><p className="text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Total</p><p className="text-lg font-medium text-[#111111] tracking-tight">${cartTotal.toFixed(2)}</p></div>
                    <div className="text-center"><p className="text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Ganancia</p><p className={`text-lg font-medium tracking-tight ${cartProfit > 0 ? 'text-[#16A34A]' : 'text-red-500'}`}>${cartProfit.toFixed(2)}</p></div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                    <input type="text" placeholder="Cliente (Opcional)" value={clientName} onChange={e => setClientName(e.target.value)} className="w-full sm:w-auto px-4 py-3 bg-white border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] outline-none text-sm transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]" />
                    <button type="button" onClick={handleConfirmCart} disabled={cart.some(c => !c.salePrice || parseFloat(c.salePrice) <= 0)} className="w-full sm:w-auto bg-[#1A1A1A] hover:bg-black text-white px-8 py-3 rounded-[1.25rem] font-medium transition-all shadow-md shadow-black/10 active:scale-95 touch-manipulation disabled:bg-[#F4F5F4] disabled:text-[#A1A1AA] disabled:cursor-not-allowed">Confirmar Venta{cart.length > 1 ? ` (${cart.length})` : ''}</button>
                  </div>
                </div>
              </div>
            )}

            {/* Grid de productos */}
            {filteredProducts.length > 0 ? (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] mb-3">{searchTerm ? 'Resultados' : 'Todos los productos — toca para agregar'}</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {filteredProducts.map(p => {
                    const inCart = cart.find(c => c.product.id === p.id);
                    return (
                      <button 
                        key={p.id} 
                        type="button" 
                        onClick={() => {
                          if (p.stock === 0) {
                            setQuickRestockProduct(p);
                            setQuickRestockFields({ quantity: '1', unit_cost: String((p.avg_cost ?? p.cost) || '') });
                          } else {
                            handleAddToCart(p);
                          }
                        }} 
                        className={`relative flex flex-col items-start text-left bg-[#F9FAFA] border-2 rounded-[1.25rem] p-3 transition-all touch-manipulation active:scale-95 ${inCart ? 'border-[#C8F169] bg-[#E8F8B6]/20' : 'border-[#EAEAEC] hover:border-[#C8F169]/50 hover:bg-white'} ${p.stock === 0 ? 'opacity-60 cursor-pointer border-dashed hover:border-[#C8F169]/80' : 'cursor-pointer'}`}
                      >
                        {p.imageUrl && <img src={p.imageUrl} alt={p.name} className="w-full h-20 object-cover rounded-[0.75rem] mb-2 border border-[#EAEAEC]" />}
                        {!p.imageUrl && <div className="w-full h-20 bg-[#EAEAEC] rounded-[0.75rem] mb-2 flex items-center justify-center"><Package size={20} className="text-[#A1A1AA]" /></div>}
                        <p className="text-xs font-medium text-[#111111] leading-tight line-clamp-2 mb-1">{p.name}</p>
                        <p className="text-xs font-bold text-[#111111]">${(p.price || 0).toFixed(2)}</p>
                        <span className={`mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${p.stock > 10 ? 'bg-[#E8F8B6]/50 text-[#4A6310]' : p.stock > 0 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'}`}>{p.stock === 0 ? 'Sin stock' : `${p.stock} uds.`}</span>
                        {inCart && <div className="absolute top-2 right-2 w-5 h-5 bg-[#C8F169] rounded-full flex items-center justify-center text-[10px] font-bold text-[#1A1A1A]">{inCart.quantity}</div>}
                      </button>
                    );
                  })}
                </div>
                {!searchTerm && (
                  <button type="button" onClick={() => setShowQuickAdd(true)} className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-[#EAEAEC] hover:border-[#C8F169] rounded-[1.25rem] text-sm font-medium text-[#71717A] hover:text-[#111111] transition-all touch-manipulation">
                    <Plus size={16} /><span>Agregar nuevo producto al inventario</span>
                  </button>
                )}
              </div>
            ) : searchTerm ? (
              <div className="text-center py-8 flex flex-col items-center">
                <p className="text-[#71717A] font-medium mb-4">No se encontraron productos en el inventario.</p>
                <button onClick={() => {setNewProduct({ name: searchTerm, cost: '', price: '', stock: '', imagePreview: null }); setShowQuickAdd(true);}} className="bg-[#C8F169] text-[#1A1A1A] hover:bg-[#b8e354] px-6 py-3.5 rounded-[1.25rem] text-sm font-medium transition-all inline-flex items-center space-x-2 active:scale-95 touch-manipulation">
                  <Plus size={18} /><span>Agregar "{searchTerm}" al Inventario</span>
                </button>
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-[#71717A] font-medium mb-4">No hay productos en el inventario.</p>
                <button onClick={() => setShowQuickAdd(true)} className="bg-[#C8F169] text-[#1A1A1A] hover:bg-[#b8e354] px-6 py-3.5 rounded-[1.25rem] text-sm font-medium transition-all inline-flex items-center space-x-2 active:scale-95 touch-manipulation"><Plus size={18} /><span>Agregar primer producto</span></button>
              </div>
            )}
          </>
        ) : (
          <form onSubmit={handleRecordSale} className="space-y-6 w-full">
            <div className="bg-[#F9FAFA] p-4 md:p-5 rounded-[1.5rem] flex flex-col md:flex-row justify-between items-start md:items-center border border-[#EAEAEC] gap-4">
              <div className="flex items-center space-x-4 w-full">
                {selectedProduct.imageUrl && <img src={selectedProduct.imageUrl} alt={selectedProduct.name} className="w-16 h-16 rounded-2xl object-cover border border-[#EAEAEC] shadow-sm flex-shrink-0" />}
                <div className="flex-1">
                  <p className="text-[10px] text-[#71717A] font-bold uppercase tracking-widest mb-1">Producto Seleccionado</p>
                  <p className="text-lg md:text-xl font-medium text-[#111111] leading-tight tracking-tight">{selectedProduct.name}</p>
                  <p className="text-sm text-[#71717A] mt-1 font-medium">Stock: <span className="text-[#111111]">{selectedProduct.stock}</span> | Costo base: <span className="text-[#111111]">${(selectedProduct.cost || 0).toFixed(2)}</span></p>
                </div>
              </div>
              <button type="button" onClick={() => setSelectedProduct(null)} className="text-sm font-medium text-[#111111] hover:text-black transition-colors bg-white border border-[#EAEAEC] shadow-sm px-5 py-2.5 rounded-[1rem] w-full md:w-auto touch-manipulation">Cambiar Producto</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5 w-full">
              <div><label className="block text-sm font-medium text-[#71717A] mb-2">Costo para ti ($)</label><div className="relative"><DollarSign className="absolute left-4 top-3.5 text-[#A1A1AA]" size={18} /><input type="number" step="0.01" required value={saleCost} onChange={(e) => setSaleCost(e.target.value)} className="w-full pl-11 pr-4 py-3 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" placeholder="0.00" /></div></div>
              <div><label className="block text-sm font-medium text-[#71717A] mb-2">Precio de Venta ($)</label><div className="relative"><DollarSign className="absolute left-4 top-3.5 text-[#A1A1AA]" size={18} /><input type="number" step="0.01" required value={salePrice} onChange={(e) => setSalePrice(e.target.value)} className="w-full pl-11 pr-4 py-3 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" placeholder="0.00" /></div></div>
              <div><label className="block text-sm font-medium text-[#71717A] mb-2">Cantidad Vendida</label><input type="number" min="1" max={selectedProduct.stock} required value={quantity} onChange={(e) => setQuantity(parseInt(e.target.value) || 1)} className="w-full px-4 py-3 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" /></div>
              <div><label className="block text-sm font-medium text-[#71717A] mb-2">Cliente (Opcional)</label><input type="text" value={clientName} onChange={(e) => setClientName(e.target.value)} className="w-full px-4 py-3 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" placeholder="Ej. Juan Pérez" /></div>
            </div>
            {salePrice && saleCost && (
              <div className="bg-[#F9FAFA] p-5 rounded-[1.5rem] flex justify-between items-center border border-[#EAEAEC]">
                <span className="text-[#71717A] font-medium text-sm sm:text-base">Ganancia (por unidad):</span>
                <span className={`font-medium tracking-tight text-lg sm:text-xl ${(parseFloat(salePrice) - parseFloat(saleCost)) > 0 ? 'text-[#16A34A]' : 'text-red-500'}`}>${(parseFloat(salePrice) - parseFloat(saleCost)).toFixed(2)}</span>
              </div>
            )}
            <button type="submit" disabled={selectedProduct.stock < quantity} className="w-full bg-[#1A1A1A] text-white font-medium py-4 px-4 rounded-[1.25rem] hover:bg-black transition-all disabled:bg-[#F4F5F4] disabled:text-[#A1A1AA] disabled:border border-[#EAEAEC] disabled:cursor-not-allowed shadow-md shadow-black/5 active:scale-[0.98] touch-manipulation text-base md:text-lg">
              {selectedProduct.stock < quantity ? 'Stock Insuficiente' : 'Confirmar Venta'}
            </button>
          </form>
        )}
        {successMsg && <div className="mt-5 p-4 bg-[#E8F8B6]/50 text-[#4A6310] border border-[#C8F169]/40 rounded-[1.25rem] text-center font-medium animate-in fade-in slide-in-from-bottom-2">{successMsg}</div>}
        {cartSuccess && <div className="mt-5 p-4 bg-[#E8F8B6]/50 text-[#4A6310] border border-[#C8F169]/40 rounded-[1.25rem] text-center font-medium animate-in fade-in slide-in-from-bottom-2">{cartSuccess}</div>}

        {/* --- MODAL REABASTECIMIENTO RÁPIDO DESDE VENTAS --- */}
        {quickRestockProduct && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm animate-in fade-in" onClick={() => setQuickRestockProduct(null)}>
            <div className="bg-white rounded-[2rem] shadow-[0_24px_60px_rgba(0,0,0,0.12)] border border-[#EAEAEC] w-full max-w-md p-6 md:p-8 animate-in slide-in-from-bottom-4" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-medium text-[#111111] tracking-tight">Reabastecer para Vender</h3>
                <button onClick={() => setQuickRestockProduct(null)} className="p-2 rounded-[0.75rem] text-[#A1A1AA] hover:text-[#111111] hover:bg-[#EAEAEC] transition-colors touch-manipulation"><X size={18} /></button>
              </div>
              <p className="text-sm text-[#71717A] mb-5 font-medium">El producto <strong className="text-[#111111]">{quickRestockProduct.name}</strong> no tiene stock. Ingresa las unidades que acaban de llegar para agregarlas y venderlas al instante.</p>
              
              <form onSubmit={handleQuickRestockSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[#71717A] mb-2">Unidades nuevas</label>
                    <input type="number" min="1" required value={quickRestockFields.quantity} onChange={e => setQuickRestockFields({...quickRestockFields, quantity: e.target.value})} className="w-full px-4 py-3 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" placeholder="Ej. 10" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#71717A] mb-2">Costo por ud. ($)</label>
                    <div className="relative"><DollarSign className="absolute left-3 top-3.5 text-[#A1A1AA]" size={18} /><input type="number" step="0.01" min="0" required value={quickRestockFields.unit_cost} onChange={e => setQuickRestockFields({...quickRestockFields, unit_cost: e.target.value})} className="w-full pl-9 pr-4 py-3 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" placeholder="0.00" /></div>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row justify-end gap-3 pt-4 border-t border-[#EAEAEC]/60">
                  <button type="button" onClick={() => setQuickRestockProduct(null)} className="w-full sm:w-auto px-6 py-3 text-[#71717A] hover:text-[#111111] bg-[#F4F5F4] hover:bg-[#EAEAEC] rounded-[1.25rem] font-medium transition-colors touch-manipulation">Cancelar</button>
                  <button type="submit" className="w-full sm:w-auto bg-[#1A1A1A] hover:bg-black text-white px-6 py-3 rounded-[1.25rem] transition-all font-medium shadow-md shadow-black/10 active:scale-95 touch-manipulation flex items-center justify-center gap-2"><RefreshCw size={16}/><span>Agregar y Vender</span></button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DashboardView({ stats, sales, products, onRefresh }: { stats: DashboardStats; sales: Sale[]; products: Product[]; onRefresh: () => void }) {
  const [editingGroup, setEditingGroup] = useState<Sale[] | null>(null);
  const [editFields, setEditFields] = useState({ salePrice: '', costAtSale: '', quantity: '', date: '', clientName: '' });
  const [editSuccess, setEditSuccess] = useState('');
  const [confirmDeleteSaleId, setConfirmDeleteSaleId] = useState<string | null>(null);

  const handleOpenEdit = (group: Sale[]) => {
    setEditingGroup(group);
    const firstSale = group[0];
    setEditFields({
      salePrice: String(firstSale.salePrice),
      costAtSale: String(firstSale.costAtSale),
      quantity: String(firstSale.quantity),
      date: firstSale.date ? firstSale.date.slice(0, 10) : '',
      clientName: firstSale.clientName || 'Cliente Anónimo',
    });
  };

  const handleEditSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingGroup || !supabase) return;
    try {
      const isMulti = editingGroup.length > 1;
      for (const sale of editingGroup) {
        const updates: any = {
          date: new Date(editFields.date).toISOString(),
          client_name: editFields.clientName.trim() || 'Cliente Anónimo',
        };
        if (!isMulti) {
          updates.sale_price = parseFloat(editFields.salePrice);
          updates.cost_at_sale = parseFloat(editFields.costAtSale);
          updates.quantity = parseInt(editFields.quantity);
        }
        await supabase.from('sales').update(updates).eq('id', sale.id).throwOnError();
      }
      setEditingGroup(null);
      onRefresh();
      setEditSuccess('¡Venta actualizada con éxito!');
      setTimeout(() => setEditSuccess(''), 3000);
    } catch (err) { console.error(err); alert("Error actualizando venta."); }
  };

  const handleDeleteGroup = async (group: Sale[]) => {
    if (!supabase) return;
    try {
      for (const sale of group) {
        const product = products.find(p => p.id === sale.productId);
        if (product) {
          await supabase.from('products').update({ stock: product.stock + sale.quantity }).eq('id', product.id).throwOnError();
        }
        await supabase.from('sales').delete().eq('id', sale.id).throwOnError();
      }
      setConfirmDeleteSaleId(null);
      onRefresh();
    } catch (err) { console.error(err); alert("Error eliminando venta."); }
  };

  const groupedSales = useMemo(() => {
    const groups: Record<string, Sale[]> = {};
    sales.forEach(sale => {
      // Agrupamos por fecha (exacta) y cliente, esto permite juntar ventas múltiples registradas en la misma transacción
      const key = `${sale.date}_${sale.clientName || 'Cliente Anónimo'}`; 
      if (!groups[key]) groups[key] = [];
      groups[key].push(sale);
    });
    return Object.values(groups).sort((a, b) => new Date(b[0].date).getTime() - new Date(a[0].date).getTime());
  }, [sales]);

  const isEditingMulti = editingGroup && editingGroup.length > 1;

  return (
    <div className="space-y-6 md:space-y-8 w-full">
      <h2 className="text-[1.75rem] font-medium text-[#111111] tracking-tight">Resumen Financiero</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        <div className="bg-white p-5 md:p-6 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-[#EAEAEC] flex items-center space-x-4 md:space-x-5"><div className="p-4 bg-[#F0FDF4] text-[#16A34A] rounded-[1.25rem] border border-[#DCFCE7]"><DollarSign size={24} className="md:w-7 md:h-7" /></div><div><p className="text-[11px] text-[#71717A] font-bold uppercase tracking-widest mb-1">Ingresos Totales</p><p className="text-2xl md:text-[2rem] font-medium tracking-tight text-[#111111]">${stats.totalRevenue.toFixed(2)}</p></div></div>
        <div className="bg-white p-5 md:p-6 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-[#EAEAEC] flex items-center space-x-4 md:space-x-5"><div className="p-4 bg-[#C8F169]/20 text-[#4D6B10] rounded-[1.25rem] border border-[#C8F169]/40"><TrendingUp size={24} className="md:w-7 md:h-7" /></div><div><p className="text-[11px] text-[#71717A] font-bold uppercase tracking-widest mb-1">Ganancia Neta</p><p className="text-2xl md:text-[2rem] font-medium tracking-tight text-[#111111]">${stats.totalProfit.toFixed(2)}</p></div></div>
        <div className="bg-white p-5 md:p-6 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-[#EAEAEC] flex items-center space-x-4 md:space-x-5 sm:col-span-2 lg:col-span-1"><div className="p-4 bg-[#1A1A1A] text-white rounded-[1.25rem] border border-[#333]"><PackageMinus size={24} className="md:w-7 md:h-7" /></div><div><p className="text-[11px] text-[#71717A] font-bold uppercase tracking-widest mb-1">Artículos Vendidos</p><p className="text-2xl md:text-[2rem] font-medium tracking-tight text-[#111111]">{stats.itemsSold}</p></div></div>
      </div>
      <div className="bg-white rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-[#EAEAEC] overflow-hidden w-full">
        <div className="px-4 md:px-6 py-5 md:py-6 border-b border-[#EAEAEC]"><h3 className="text-lg font-medium text-[#111111] tracking-tight">Últimas Ventas</h3></div>
        <div className="overflow-x-auto w-full" style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}><table className="w-full text-left border-collapse min-w-[600px]">
          <thead><tr className="bg-white text-[#A1A1AA] text-[11px] font-bold uppercase tracking-widest border-b border-[#EAEAEC]"><th className="px-4 md:px-6 py-4 md:py-5">Fecha</th><th className="px-4 md:px-6 py-4 md:py-5">Producto</th><th className="px-4 md:px-6 py-4 md:py-5">Cant.</th><th className="px-4 md:px-6 py-4 md:py-5">Venta</th><th className="px-4 md:px-6 py-4 md:py-5">Ganancia</th><th className="px-4 md:px-6 py-4 md:py-5"></th></tr></thead>
          <tbody className="divide-y divide-[#EAEAEC]/60">
            {groupedSales.length === 0 ? <tr><td colSpan={6} className="px-6 py-10 text-center text-[#71717A] font-medium">No hay ventas registradas.</td></tr> : groupedSales.map(group => {
              const firstSale = group[0];
              const isMulti = group.length > 1;
              const totalQty = group.reduce((sum, s) => sum + (s.quantity || 0), 0);
              const totalSale = group.reduce((sum, s) => sum + ((s.salePrice || 0) * (s.quantity || 0)), 0);
              const totalProfit = group.reduce((sum, s) => sum + (((s.salePrice || 0) - (s.costAtSale || 0)) * (s.quantity || 0)), 0);

              return (
                <tr key={firstSale.id} className="hover:bg-[#F9FAFA] transition-colors align-top">
                  <td className="px-4 md:px-6 py-4 md:py-5 text-sm text-[#71717A] font-medium">{new Date(firstSale.date).toLocaleDateString()}</td>
                  <td className="px-4 md:px-6 py-4 md:py-5">
                    {firstSale.clientName && (
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] mb-0.5">Cliente: <span className="text-[#111111]">{firstSale.clientName}</span></p>
                    )}
                    <p className="font-medium text-[#111111]">
                      {isMulti ? `Pedido Agrupado (${group.length} prods.)` : (products.find(p => p.id === firstSale.productId)?.name || 'Producto Eliminado')}
                    </p>
                    {isMulti && (
                      <div className="text-xs text-[#71717A] mt-1 space-y-0.5">
                        {group.map(s => (
                          <p key={s.id}>• {s.quantity}x {products.find(p => p.id === s.productId)?.name || 'Eliminado'}</p>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 md:px-6 py-4 md:py-5 text-[#71717A] font-medium">{totalQty}</td>
                  <td className="px-4 md:px-6 py-4 md:py-5 font-medium text-[#111111]">${totalSale.toFixed(2)}</td>
                  <td className="px-4 md:px-6 py-4 md:py-5 font-medium text-[#16A34A]">+${totalProfit.toFixed(2)}</td>
                  <td className="px-4 md:px-6 py-4 md:py-5">
                    {confirmDeleteSaleId === firstSale.id ? (
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => handleDeleteGroup(group)} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-[0.75rem] transition-all active:scale-95 touch-manipulation">Sí</button>
                        <button onClick={() => setConfirmDeleteSaleId(null)} className="px-3 py-1.5 bg-[#F4F5F4] hover:bg-[#EAEAEC] text-[#71717A] text-xs font-bold rounded-[0.75rem] transition-colors touch-manipulation">No</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <button onClick={() => handleOpenEdit(group)} className="p-2 rounded-[0.75rem] text-[#A1A1AA] hover:text-[#111111] hover:bg-[#EAEAEC] transition-colors touch-manipulation"><Pencil size={15} /></button>
                        <button onClick={() => setConfirmDeleteSaleId(firstSale.id)} className="p-2 rounded-[0.75rem] text-[#A1A1AA] hover:text-red-500 hover:bg-red-50 transition-colors touch-manipulation"><Trash2 size={15} /></button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>
      {editSuccess && <div className="p-4 bg-[#E8F8B6]/50 text-[#4A6310] border border-[#C8F169]/40 rounded-[1.25rem] text-center font-medium animate-in fade-in slide-in-from-bottom-2">{editSuccess}</div>}

      {/* --- MODAL EDITAR VENTA --- */}
      {editingGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm animate-in fade-in" onClick={() => { setEditingGroup(null); onRefresh(); }}>
          <div className="bg-white rounded-[2rem] shadow-[0_24px_60px_rgba(0,0,0,0.12)] border border-[#EAEAEC] w-full max-w-lg p-6 md:p-8 animate-in slide-in-from-bottom-4" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-medium text-[#111111] tracking-tight">{isEditingMulti ? 'Editar Pedido Agrupado' : 'Editar Venta'}</h3>
              <button onClick={() => setEditingGroup(null)} className="p-2 rounded-[0.75rem] text-[#A1A1AA] hover:text-[#111111] hover:bg-[#EAEAEC] transition-colors touch-manipulation"><X size={18} /></button>
            </div>
            
            {isEditingMulti && (
              <p className="text-sm font-medium text-[#71717A] mb-4">Estás editando un pedido agrupado. Solo puedes modificar la fecha y el nombre del cliente general.</p>
            )}

            <form onSubmit={handleEditSave} className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {!isEditingMulti && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-[#71717A] mb-2">Costo para ti ($)</label>
                      <div className="relative"><DollarSign className="absolute left-4 top-3.5 text-[#A1A1AA]" size={18} /><input type="number" step="0.01" required value={editFields.costAtSale} onChange={e => setEditFields({...editFields, costAtSale: e.target.value})} className="w-full pl-11 pr-4 py-3 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" placeholder="0.00" /></div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[#71717A] mb-2">Precio de Venta ($)</label>
                      <div className="relative"><DollarSign className="absolute left-4 top-3.5 text-[#A1A1AA]" size={18} /><input type="number" step="0.01" required value={editFields.salePrice} onChange={e => setEditFields({...editFields, salePrice: e.target.value})} className="w-full pl-11 pr-4 py-3 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" placeholder="0.00" /></div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[#71717A] mb-2">Cantidad Vendida</label>
                      <input type="number" min="1" required value={editFields.quantity} onChange={e => setEditFields({...editFields, quantity: e.target.value})} className="w-full px-4 py-3 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" />
                    </div>
                  </>
                )}
                <div>
                  <label className="block text-sm font-medium text-[#71717A] mb-2">Fecha</label>
                  <input type="date" required value={editFields.date} onChange={e => setEditFields({...editFields, date: e.target.value})} className="w-full px-4 py-3 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" />
                </div>
                <div className={!isEditingMulti ? "sm:col-span-2" : ""}>
                  <label className="block text-sm font-medium text-[#71717A] mb-2">Cliente</label>
                  <input type="text" required value={editFields.clientName} onChange={e => setEditFields({...editFields, clientName: e.target.value})} className="w-full px-4 py-3 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" placeholder="Cliente Anónimo" />
                </div>
              </div>
              {!isEditingMulti && editFields.salePrice && editFields.costAtSale && (
                <div className="bg-[#F9FAFA] p-4 rounded-[1.25rem] flex justify-between items-center border border-[#EAEAEC]">
                  <span className="text-[#71717A] font-medium text-sm">Ganancia (por unidad):</span>
                  <span className={`font-medium tracking-tight text-lg ${(parseFloat(editFields.salePrice) - parseFloat(editFields.costAtSale)) > 0 ? 'text-[#16A34A]' : 'text-red-500'}`}>${(parseFloat(editFields.salePrice) - parseFloat(editFields.costAtSale)).toFixed(2)}</span>
                </div>
              )}
              <div className="flex flex-col sm:flex-row justify-end gap-3 pt-2 border-t border-[#EAEAEC]/60">
                <button type="button" onClick={() => { setEditingGroup(null); onRefresh(); }} className="w-full sm:w-auto px-6 py-3 text-[#71717A] hover:text-[#111111] bg-[#F4F5F4] hover:bg-[#EAEAEC] rounded-[1.25rem] font-medium transition-colors touch-manipulation">Cancelar</button>
                <button type="submit" className="w-full sm:w-auto bg-[#1A1A1A] hover:bg-black text-white px-8 py-3 rounded-[1.25rem] transition-all font-medium shadow-md shadow-black/10 active:scale-95 touch-manipulation">Guardar Cambios</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function InventoryView({ products, userId, sales, restocks, onRefresh }: { products: Product[]; userId?: string; sales: Sale[]; restocks: Restock[]; onRefresh: () => void }) {
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [showAdd, setShowAdd] = useState<boolean>(false);
  const [newProduct, setNewProduct] = useState<NewProductState>({ name: '', cost: '', price: '', stock: '', imagePreview: null });
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [editName, setEditName] = useState<string>('');
  const [editNameSuccess, setEditNameSuccess] = useState<string>('');
  const [showRestock, setShowRestock] = useState<boolean>(false);
  const [restockFields, setRestockFields] = useState({ quantity: '', unit_cost: '' });
  const [restockSuccess, setRestockSuccess] = useState<string>('');
  const [editAlert, setEditAlert] = useState<string>('');
  const [alertSuccess, setAlertSuccess] = useState<string>('');
  const [confirmDelete, setConfirmDelete] = useState<boolean>(false);
  const [editingRestockId, setEditingRestockId] = useState<string | null>(null);
  const [editRestockFields, setEditRestockFields] = useState({ quantity: '', unit_cost: '' });
  const [confirmDeleteRestockId, setConfirmDeleteRestockId] = useState<string | null>(null);
  const [editImagePreview, setEditImagePreview] = useState<string | null>(null);
  const [imageSuccess, setImageSuccess] = useState<string>('');
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [isDraggingEdit, setIsDraggingEdit] = useState<boolean>(false);

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = await uploadImageToR2(file);
      setNewProduct({ ...newProduct, imagePreview: url });
    } catch (err) { console.error(err); }
  };

  const handleAdd = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!userId || !supabase) return;
    const existingProduct = products.find(p => p.name.toLowerCase().trim() === newProduct.name.toLowerCase().trim());
    try {
      if (existingProduct) {
        await supabase.from('products').update({ 
          stock: existingProduct.stock + parseInt(newProduct.stock), 
          cost: parseFloat(newProduct.cost), 
          price: parseFloat(newProduct.price) 
        }).eq('id', existingProduct.id).eq('user_id', userId).throwOnError();
      } else {
        await supabase.from('products').insert([{ 
          name: newProduct.name, 
          cost: parseFloat(newProduct.cost), 
          price: parseFloat(newProduct.price), 
          stock: parseInt(newProduct.stock), 
          image_url: newProduct.imagePreview,
          user_id: userId
        }]).throwOnError();
      }
      setNewProduct({ name: '', cost: '', price: '', stock: '', imagePreview: null }); setShowAdd(false); onRefresh();
    } catch (err) { console.error(err); alert("Error guardando producto"); }
  };

  const handleOpenDetail = (product: Product) => {
    setDetailProduct(product);
    setEditName(product.name);
    setEditNameSuccess('');
    setShowRestock(false);
    setRestockFields({ quantity: '', unit_cost: '' });
    setRestockSuccess('');
    setEditAlert(product.stock_alert != null ? String(product.stock_alert) : '');
    setAlertSuccess('');
    setConfirmDelete(false);
    setEditImagePreview(null);
    setImageSuccess('');
  };

  const handleSaveName = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!detailProduct || !supabase || !userId || !editName.trim()) return;
    try {
      await supabase.from('products').update({ name: editName.trim() }).eq('id', detailProduct.id).eq('user_id', userId).throwOnError();
      setDetailProduct({ ...detailProduct, name: editName.trim() });
      setEditNameSuccess('¡Nombre actualizado!');
      setTimeout(() => setEditNameSuccess(''), 3000);
    } catch (err) { console.error(err); alert("Error al guardar nombre"); }
  };

  const handleRestock = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!detailProduct || !supabase || !userId) return;
    const qty = parseInt(restockFields.quantity);
    const unitCost = parseFloat(restockFields.unit_cost);
    try {
      const currentStock = detailProduct.stock;
      const currentCost = detailProduct.avg_cost ?? detailProduct.cost;
      const newAvgCost = currentStock + qty > 0
        ? ((currentStock * currentCost) + (qty * unitCost)) / (currentStock + qty)
        : unitCost;
      await supabase.from('restocks').insert([{ product_id: detailProduct.id, quantity: qty, unit_cost: unitCost, date: new Date().toISOString(), user_id: userId }]).throwOnError();
      await supabase.from('products').update({ stock: currentStock + qty, cost: newAvgCost, avg_cost: newAvgCost }).eq('id', detailProduct.id).eq('user_id', userId).throwOnError();
      setDetailProduct({ ...detailProduct, stock: currentStock + qty, cost: newAvgCost, avg_cost: newAvgCost });
      setRestockFields({ quantity: '', unit_cost: '' });
      setShowRestock(false);
      setRestockSuccess(`¡Reabastecido! Costo promedio actualizado a $${newAvgCost.toFixed(2)}`);
      setTimeout(() => setRestockSuccess(''), 4000);
    } catch (err) { console.error(err); alert("Error reabasteciendo"); }
  };

  const handleSaveAlert = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!detailProduct || !supabase || !userId) return;
    const alertVal = editAlert === '' ? null : parseInt(editAlert);
    try {
      await supabase.from('products').update({ stock_alert: alertVal }).eq('id', detailProduct.id).eq('user_id', userId).throwOnError();
      setDetailProduct({ ...detailProduct, stock_alert: alertVal });
      setAlertSuccess('¡Alerta guardada!');
      setTimeout(() => setAlertSuccess(''), 3000);
    } catch (err) { console.error(err); alert("Error guardando alerta"); }
  };

  const handleDeleteProduct = async () => {
    if (!detailProduct || !supabase || !userId) return;
    try {
      if (detailProduct.imageUrl) {
        await deleteImageFromR2(detailProduct.imageUrl);
      }
      await supabase.from('sales').delete().eq('product_id', detailProduct.id).throwOnError();
      await supabase.from('restocks').delete().eq('product_id', detailProduct.id).throwOnError();
      await supabase.from('products').delete().eq('id', detailProduct.id).eq('user_id', userId).throwOnError();
      
      setDetailProduct(null);
      onRefresh();
    } catch (err: any) { 
      console.error("Error eliminando producto:", err); 
      alert("Hubo un error al eliminar. Revisa la consola: " + err.message);
    }
  };

  const uploadAndSaveImage = async (file: File) => {
    if (!detailProduct || !supabase || !userId) return;
    try {
      if (detailProduct.imageUrl) {
        await deleteImageFromR2(detailProduct.imageUrl);
      }
      const url = await uploadImageToR2(file);
      await supabase.from('products').update({ image_url: url }).eq('id', detailProduct.id).eq('user_id', userId).throwOnError();
      setDetailProduct({ ...detailProduct, image_url: url, imageUrl: url });
      setEditImagePreview(url);
      setImageSuccess('¡Imagen actualizada!');
      setTimeout(() => setImageSuccess(''), 3000);
    } catch (err) { console.error(err); alert("Error guardando imagen"); }
  };

  const handleEditImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadAndSaveImage(file);
  };

  const handleRemoveImage = async () => {
    if (!detailProduct || !supabase || !userId) return;
    try {
      if (detailProduct.imageUrl) {
        await deleteImageFromR2(detailProduct.imageUrl);
      }
      await supabase.from('products').update({ image_url: null }).eq('id', detailProduct.id).eq('user_id', userId).throwOnError();
      setDetailProduct({ ...detailProduct, image_url: null, imageUrl: null });
      setEditImagePreview(null);
      setImageSuccess('¡Imagen eliminada!');
      setTimeout(() => setImageSuccess(''), 3000);
    } catch (err) { console.error(err); alert("Error eliminando imagen"); }
  };

  const handleSaveRestock = async (restockId: string) => {
    if (!detailProduct || !supabase || !userId) return;
    const qty = parseInt(editRestockFields.quantity);
    const unitCost = parseFloat(editRestockFields.unit_cost);
    if (!qty || !unitCost) return;
    try {
      await supabase.from('restocks').update({ quantity: qty, unit_cost: unitCost }).eq('id', restockId).throwOnError();
      const { data: allRestocks } = await supabase.from('restocks').select('*').eq('product_id', detailProduct.id);
      if (allRestocks && allRestocks.length > 0) {
        const totalQty = allRestocks.reduce((s: number, r: Restock) => s + r.quantity, 0);
        const totalCost = allRestocks.reduce((s: number, r: Restock) => s + r.quantity * r.unit_cost, 0);
        const newAvg = totalQty > 0 ? totalCost / totalQty : unitCost;
        await supabase.from('products').update({ avg_cost: newAvg, cost: newAvg, stock: totalQty }).eq('id', detailProduct.id).eq('user_id', userId).throwOnError();
        setDetailProduct({ ...detailProduct, avg_cost: newAvg, cost: newAvg, stock: totalQty });
      }
      setEditingRestockId(null);
      onRefresh();
    } catch (err) { console.error(err); alert("Error actualizando reabastecimiento"); }
  };

  const handleDeleteRestock = async (restockId: string, restockQty: number) => {
    if (!detailProduct || !supabase || !userId) return;
    try {
      await supabase.from('restocks').delete().eq('id', restockId).throwOnError();
      const newStock = Math.max(0, detailProduct.stock - restockQty);
      const { data: allRestocks } = await supabase.from('restocks').select('*').eq('product_id', detailProduct.id);
      const remaining = (allRestocks || []) as Restock[];
      const totalQty = remaining.reduce((s, r) => s + r.quantity, 0);
      const totalCost = remaining.reduce((s, r) => s + r.quantity * r.unit_cost, 0);
      const newAvg = totalQty > 0 ? totalCost / totalQty : detailProduct.cost;
      await supabase.from('products').update({ stock: newStock, avg_cost: newAvg, cost: newAvg }).eq('id', detailProduct.id).eq('user_id', userId).throwOnError();
      setDetailProduct({ ...detailProduct, stock: newStock, avg_cost: newAvg, cost: newAvg });
      setConfirmDeleteRestockId(null);
      onRefresh();
    } catch (err) { console.error(err); alert("Error eliminando reabastecimiento"); }
  };

  const productRestocks = detailProduct
    ? restocks.filter(r => r.product_id === detailProduct.id).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    : [];

  const productSales = detailProduct
    ? sales.filter(s => s.productId === detailProduct.id).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    : [];

  const totalUnits = productSales.reduce((acc, s) => acc + (s.quantity || 0), 0);
  const totalRevenue = productSales.reduce((acc, s) => acc + (s.salePrice || 0) * (s.quantity || 0), 0);
  const totalProfit = productSales.reduce((acc, s) => acc + ((s.salePrice || 0) - (s.costAtSale || 0)) * (s.quantity || 0), 0);
  const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

  return (
    <div className="space-y-6 w-full">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-[1.75rem] font-medium text-[#111111] tracking-tight">Inventario de Productos</h2>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full sm:w-auto">
          <div className="flex bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1rem] p-1 flex-shrink-0">
            <button onClick={() => setViewMode('list')} className={`p-2 rounded-[0.75rem] transition-all touch-manipulation ${viewMode === 'list' ? 'bg-white shadow-sm border border-[#EAEAEC] text-[#111111]' : 'text-[#A1A1AA] hover:text-[#111111]'}`}><List size={18} /></button>
            <button onClick={() => setViewMode('grid')} className={`p-2 rounded-[0.75rem] transition-all touch-manipulation ${viewMode === 'grid' ? 'bg-white shadow-sm border border-[#EAEAEC] text-[#111111]' : 'text-[#A1A1AA] hover:text-[#111111]'}`}><LayoutGrid size={18} /></button>
          </div>
          <button onClick={() => setShowAdd(!showAdd)} className="bg-[#1A1A1A] hover:bg-black text-white px-6 py-3 sm:py-3 rounded-[1.25rem] flex items-center justify-center space-x-2 transition-all shadow-md shadow-black/10 active:scale-95 font-medium w-full sm:w-auto touch-manipulation"><Plus size={18} /><span>Nuevo Producto</span></button>
        </div>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="bg-white p-4 md:p-8 rounded-[2rem] border border-[#EAEAEC] shadow-[0_8px_30px_rgb(0,0,0,0.04)] grid grid-cols-1 md:grid-cols-5 gap-4 md:gap-5 items-end animate-in fade-in slide-in-from-top-4 w-full">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-[#71717A] mb-2">Nombre (Tipo de media)</label>
            <input type="text" required value={newProduct.name} onChange={e => setNewProduct({...newProduct, name: e.target.value})} className="w-full px-4 py-3 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" placeholder="Ej. Medias de compresión" />
            {/* ✨ SUGERIDOR DE NOMBRE */}
            <NameSuggester
              imagePreview={newProduct.imagePreview}
              currentName={newProduct.name}
              existingNames={products.map(p => p.name)}
              onSelect={(name) => setNewProduct({ ...newProduct, name })}
            />
          </div>
          <div><label className="block text-sm font-medium text-[#71717A] mb-2">Costo ($)</label><input type="number" step="0.01" required value={newProduct.cost} onChange={e => setNewProduct({...newProduct, cost: e.target.value})} className="w-full px-4 py-3 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" placeholder="0.00" /></div>
          <div><label className="block text-sm font-medium text-[#71717A] mb-2">Precio Venta ($)</label><input type="number" step="0.01" required value={newProduct.price} onChange={e => setNewProduct({...newProduct, price: e.target.value})} className="w-full px-4 py-3 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" placeholder="0.00" /></div>
          <div><label className="block text-sm font-medium text-[#71717A] mb-2">Stock Inicial</label><input type="number" required value={newProduct.stock} onChange={e => setNewProduct({...newProduct, stock: e.target.value})} className="w-full px-4 py-3 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" placeholder="0" /></div>
          <div className="md:col-span-5"><label className="block text-sm font-medium text-[#71717A] mb-2">Fotografía del Producto (Opcional)</label><label className="flex items-center gap-3 w-full px-4 py-3 bg-[#F9FAFA] border-2 border-dashed border-[#EAEAEC] rounded-[1.25rem] hover:border-[#C8F169] hover:bg-[#E8F8B6]/10 transition-all cursor-pointer text-[#71717A] text-sm font-medium" onDragOver={e => e.preventDefault()} onDrop={async e => { e.preventDefault(); const file = e.dataTransfer.files?.[0]; if (file && file.type.startsWith('image/')) { try { const url = await uploadImageToR2(file); setNewProduct({...newProduct, imagePreview: url}); } catch(err){console.error(err);} }}}><ImagePlus size={16} /><span>{newProduct.imagePreview ? '✓ Imagen lista — clic para cambiar o arrastra otra' : 'Clic para seleccionar o arrastra una imagen aquí'}</span><input type="file" accept="image/*" onChange={handleImageChange} className="hidden" /></label></div>
          <div className="md:col-span-5 flex flex-col sm:flex-row justify-end mt-4 pt-6 border-t border-[#EAEAEC]/60 gap-3"><button type="button" onClick={() => setShowAdd(false)} className="w-full sm:w-auto px-6 py-3 sm:py-3 text-[#71717A] hover:text-[#111111] bg-[#F4F5F4] hover:bg-[#EAEAEC] rounded-[1.25rem] font-medium transition-colors touch-manipulation">Cancelar</button><button type="submit" className="w-full sm:w-auto bg-[#1A1A1A] hover:bg-black text-white px-8 py-3 sm:py-3 rounded-[1.25rem] transition-all font-medium shadow-md shadow-black/10 active:scale-95 touch-manipulation">Guardar Producto</button></div>
        </form>
      )}

      {products.length === 0 ? (
        <div className="col-span-full text-center py-10 text-[#71717A] font-medium">Tu inventario está vacío. ¡Agrega tu primer producto!</div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 w-full animate-in fade-in">
          {products.map(product => (
            <div key={product.id} onClick={() => handleOpenDetail(product)} className="bg-white p-5 rounded-[2rem] shadow-[0_4px_24px_rgba(0,0,0,0.02)] border border-[#EAEAEC] hover:shadow-[0_8px_30px_rgb(0,0,0,0.06)] transition-all duration-300 flex flex-col h-full cursor-pointer active:scale-[0.98]"><div className="flex justify-between items-start mb-5 gap-2"><h3 className="font-medium text-[#111111] text-base md:text-lg leading-tight tracking-tight flex-1">{product.name}</h3><span className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-full flex-shrink-0 ${product.stock > 10 ? 'bg-[#E8F8B6]/50 text-[#4A6310]' : product.stock > 0 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'}`}>{product.stock} en stock</span></div><div className="w-full h-40 bg-[#F9FAFA] rounded-[1.25rem] mb-5 flex items-center justify-center border border-[#EAEAEC] overflow-hidden relative">{product.imageUrl ? <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" /> : <span className="text-[#A1A1AA] text-sm font-medium tracking-wide">[Sin imagen]</span>}</div><div className="mt-auto space-y-2"><div className="flex justify-between items-center text-sm bg-[#F9FAFA] p-3 rounded-[1rem] border border-[#EAEAEC]"><span className="text-[#71717A] font-medium text-xs">Costo base:</span><span className="font-medium text-[#111111]">${(product.cost || 0).toFixed(2)}</span></div><div className="flex justify-between items-center text-sm bg-white p-3 rounded-[1rem] border border-[#EAEAEC]"><span className="text-[#71717A] font-medium text-xs">Precio Venta:</span><span className="font-medium tracking-tight text-[#111111]">${(product.price || 0).toFixed(2)}</span></div></div></div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-[#EAEAEC] overflow-hidden w-full animate-in fade-in">
          <div className="overflow-x-auto w-full" style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
            <table className="w-full text-left border-collapse min-w-[600px]">
              <thead>
                <tr className="bg-white text-[#A1A1AA] text-[11px] font-bold uppercase tracking-widest border-b border-[#EAEAEC]">
                  <th className="px-4 md:px-6 py-4 md:py-5 w-20">Imagen</th>
                  <th className="px-4 md:px-6 py-4 md:py-5">Producto</th>
                  <th className="px-4 md:px-6 py-4 md:py-5">Stock</th>
                  <th className="px-4 md:px-6 py-4 md:py-5">Costo Base</th>
                  <th className="px-4 md:px-6 py-4 md:py-5">Precio Venta</th>
                  <th className="px-4 md:px-6 py-4 md:py-5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAEAEC]/60">
                {products.map(product => (
                  <tr key={product.id} className="hover:bg-[#F9FAFA] transition-colors cursor-pointer group" onClick={() => handleOpenDetail(product)}>
                    <td className="px-4 md:px-6 py-3 md:py-4" onClick={(e) => e.stopPropagation()}>
                      <div
                        className="w-12 h-12 rounded-[0.75rem] bg-[#F9FAFA] border border-[#EAEAEC] flex items-center justify-center overflow-hidden relative cursor-zoom-in group/img"
                        onClick={() => product.imageUrl && setLightboxUrl(product.imageUrl)}
                      >
                        {product.imageUrl ? (
                          <>
                            <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/20 transition-all flex items-center justify-center">
                              <ZoomIn size={14} className="text-white opacity-0 group-hover/img:opacity-100 transition-opacity" />
                            </div>
                          </>
                        ) : (
                          <Package size={16} className="text-[#A1A1AA]" />
                        )}
                      </div>
                    </td>
                    <td className="px-4 md:px-6 py-3 md:py-4 font-medium text-[#111111]">{product.name}</td>
                    <td className="px-4 md:px-6 py-3 md:py-4">
                      <span className={`px-3 py-1 text-[10px] font-bold uppercase tracking-widest rounded-full flex-shrink-0 ${product.stock > 10 ? 'bg-[#E8F8B6]/50 text-[#4A6310]' : product.stock > 0 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'}`}>
                        {product.stock} en stock
                      </span>
                    </td>
                    <td className="px-4 md:px-6 py-3 md:py-4 font-medium text-[#71717A]">${(product.cost || 0).toFixed(2)}</td>
                    <td className="px-4 md:px-6 py-3 md:py-4 font-medium text-[#111111]">${(product.price || 0).toFixed(2)}</td>
                    <td className="px-4 md:px-6 py-3 md:py-4 text-right">
                       <button className="text-[#71717A] hover:text-[#111111] font-medium text-xs px-4 py-2 bg-white border border-[#EAEAEC] hover:border-[#C8F169] rounded-[1rem] transition-colors touch-manipulation">Ver Detalles</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- MODAL DETALLE / EDITAR PRODUCTO --- */}
      {detailProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm animate-in fade-in" onClick={() => { setDetailProduct(null); onRefresh(); }}>
          <div className="bg-white rounded-[2rem] shadow-[0_24px_60px_rgba(0,0,0,0.12)] border border-[#EAEAEC] w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 md:p-8 animate-in slide-in-from-bottom-4" onClick={e => e.stopPropagation()}>
            
            {/* Header */}
            <div className="flex justify-between items-start mb-6 gap-4">
              <div>
                <p className="text-[10px] text-[#71717A] font-bold uppercase tracking-widest mb-1">Detalle del Producto</p>
                <h3 className="text-xl font-medium text-[#111111] tracking-tight">{detailProduct.name}</h3>
              </div>
              <button onClick={() => { setDetailProduct(null); onRefresh(); }} className="p-2 rounded-[0.75rem] text-[#A1A1AA] hover:text-[#111111] hover:bg-[#EAEAEC] transition-colors touch-manipulation flex-shrink-0"><X size={18} /></button>
            </div>

            {/* Editar nombre */}
            <form onSubmit={handleSaveName} className="mb-6 pb-6 border-b border-[#EAEAEC]/60">
              <label className="block text-sm font-medium text-[#71717A] mb-2">Nombre del Producto</label>
              <div className="flex gap-3">
                <input type="text" required value={editName} onChange={e => setEditName(e.target.value)} className="flex-1 px-4 py-3 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" />
                <button type="submit" className="bg-[#1A1A1A] hover:bg-black text-white px-6 py-3 rounded-[1.25rem] transition-all font-medium shadow-md shadow-black/10 active:scale-95 touch-manipulation flex-shrink-0">Guardar</button>
              </div>
              {/* ✨ SUGERIDOR DE NOMBRE EN MODAL DE EDICIÓN */}
              <NameSuggester
                imagePreview={editImagePreview || detailProduct.imageUrl || null}
                currentName={editName}
                existingNames={products.filter(p => p.id !== detailProduct.id).map(p => p.name)}
                onSelect={(name) => setEditName(name)}
              />
              {editNameSuccess && <p className="mt-2 text-sm font-medium text-[#4A6310]">{editNameSuccess}</p>}
            </form>

            {/* Alerta de stock bajo */}
            <form onSubmit={handleSaveAlert} className="mb-6 pb-6 border-b border-[#EAEAEC]/60">
              <label className="block text-sm font-medium text-[#71717A] mb-2">Alerta de Stock Bajo (avisar cuando queden ≤ X unidades)</label>
              <div className="flex gap-3">
                <input type="number" min="0" value={editAlert} onChange={e => setEditAlert(e.target.value)} placeholder="Ej. 5 — dejar vacío para desactivar" className="flex-1 px-4 py-3 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" />
                <button type="submit" className="bg-[#1A1A1A] hover:bg-black text-white px-6 py-3 rounded-[1.25rem] transition-all font-medium shadow-md shadow-black/10 active:scale-95 touch-manipulation flex-shrink-0">Guardar</button>
              </div>
              {detailProduct.stock_alert != null && (
                <p className="mt-2 text-xs font-medium text-[#71717A]">Alerta activa: avisa cuando queden ≤ <span className="text-[#111111]">{detailProduct.stock_alert}</span> uds. Stock actual: <span className={detailProduct.stock <= (detailProduct.stock_alert ?? 0) ? 'text-amber-600 font-bold' : 'text-[#111111]'}>{detailProduct.stock}</span></p>
              )}
              {alertSuccess && <p className="mt-2 text-sm font-medium text-[#4A6310]">{alertSuccess}</p>}
            </form>

            {/* Reabastecer */}
            <div className="mb-6 pb-6 border-b border-[#EAEAEC]/60">
              <div className="flex justify-between items-center mb-3">
                <label className="block text-sm font-medium text-[#71717A]">Reabastecer Stock</label>
                <button type="button" onClick={() => setShowRestock(!showRestock)} className="flex items-center gap-2 bg-[#C8F169] hover:bg-[#b8e354] text-[#1A1A1A] px-4 py-2 rounded-[1rem] text-sm font-medium transition-all active:scale-95 touch-manipulation"><RefreshCw size={14} /><span>Reabastecer</span></button>
              </div>
              <div className="bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] p-3 mb-3 flex items-center justify-between">
                <span className="text-xs font-medium text-[#71717A]">Costo promedio ponderado actual:</span>
                <span className="text-sm font-bold text-[#111111]">${(detailProduct.avg_cost ?? detailProduct.cost).toFixed(2)}</span>
              </div>
              {showRestock && (
                <form onSubmit={handleRestock} className="space-y-3 animate-in fade-in slide-in-from-top-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-[#71717A] mb-1.5">Unidades a agregar</label>
                      <input type="number" min="1" required value={restockFields.quantity} onChange={e => setRestockFields({...restockFields, quantity: e.target.value})} className="w-full px-4 py-3 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" placeholder="0" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[#71717A] mb-1.5">Costo por unidad ($)</label>
                      <div className="relative"><DollarSign className="absolute left-3 top-3.5 text-[#A1A1AA]" size={16} /><input type="number" step="0.01" min="0" required value={restockFields.unit_cost} onChange={e => setRestockFields({...restockFields, unit_cost: e.target.value})} className="w-full pl-9 pr-4 py-3 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" placeholder="0.00" /></div>
                    </div>
                  </div>
                  {restockFields.quantity && restockFields.unit_cost && (
                    <div className="bg-[#F9FAFA] p-3 rounded-[1.25rem] border border-[#EAEAEC] text-xs font-medium text-[#71717A]">
                      Nuevo costo promedio: <span className="text-[#111111] font-bold">${(((detailProduct.stock * (detailProduct.avg_cost ?? detailProduct.cost)) + (parseInt(restockFields.quantity || '0') * parseFloat(restockFields.unit_cost || '0'))) / (detailProduct.stock + parseInt(restockFields.quantity || '1'))).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex gap-3">
                    <button type="button" onClick={() => setShowRestock(false)} className="flex-1 px-4 py-3 text-[#71717A] hover:text-[#111111] bg-[#F4F5F4] hover:bg-[#EAEAEC] rounded-[1.25rem] font-medium transition-colors touch-manipulation text-sm">Cancelar</button>
                    <button type="submit" className="flex-1 bg-[#1A1A1A] hover:bg-black text-white px-4 py-3 rounded-[1.25rem] transition-all font-medium shadow-md shadow-black/10 active:scale-95 touch-manipulation text-sm">Confirmar</button>
                  </div>
                </form>
              )}
              {restockSuccess && <p className="mt-3 text-sm font-medium text-[#4A6310] bg-[#E8F8B6]/50 border border-[#C8F169]/40 rounded-[1rem] px-4 py-2">{restockSuccess}</p>}
              {productRestocks.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] mb-2">Historial de Compras</p>
                  {productRestocks.map(r => (
                    <div key={r.id}>
                      {editingRestockId === r.id ? (
                        <div className="bg-[#F9FAFA] border border-[#C8F169]/60 rounded-[1rem] px-4 py-3 space-y-2 animate-in fade-in slide-in-from-top-1">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] mb-1">Unidades</label>
                              <input type="number" min="1" value={editRestockFields.quantity} onChange={e => setEditRestockFields({...editRestockFields, quantity: e.target.value})} className="w-full px-3 py-2 bg-white border border-[#EAEAEC] rounded-[0.75rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] outline-none text-sm" />
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] mb-1">Costo/ud. ($)</label>
                              <input type="number" step="0.01" min="0" value={editRestockFields.unit_cost} onChange={e => setEditRestockFields({...editRestockFields, unit_cost: e.target.value})} className="w-full px-3 py-2 bg-white border border-[#EAEAEC] rounded-[0.75rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] outline-none text-sm" />
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button type="button" onClick={() => setEditingRestockId(null)} className="flex-1 px-3 py-2 text-[#71717A] bg-white border border-[#EAEAEC] hover:bg-[#F4F5F4] rounded-[0.75rem] text-xs font-medium transition-colors touch-manipulation">Cancelar</button>
                            <button type="button" onClick={() => handleSaveRestock(r.id)} className="flex-1 px-3 py-2 bg-[#1A1A1A] hover:bg-black text-white rounded-[0.75rem] text-xs font-medium transition-all active:scale-95 touch-manipulation">Guardar</button>
                          </div>
                        </div>
                      ) : confirmDeleteRestockId === r.id ? (
                        <div className="bg-red-50 border border-red-200 rounded-[1rem] px-4 py-3 flex items-center justify-between gap-3 animate-in fade-in">
                          <span className="text-xs font-medium text-red-700">¿Eliminar este reabastecimiento?</span>
                          <div className="flex gap-2 flex-shrink-0">
                            <button type="button" onClick={() => handleDeleteRestock(r.id, r.quantity)} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-[0.75rem] transition-all active:scale-95 touch-manipulation">Sí</button>
                            <button type="button" onClick={() => setConfirmDeleteRestockId(null)} className="px-3 py-1.5 bg-white border border-[#EAEAEC] text-[#71717A] text-xs font-bold rounded-[0.75rem] transition-colors touch-manipulation">No</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between bg-white border border-[#EAEAEC] rounded-[1rem] px-4 py-2.5 group hover:border-[#C8F169]/40 transition-colors">
                          <span className="text-xs font-medium text-[#71717A]">{new Date(r.date).toLocaleDateString()}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-medium text-[#111111]">+{r.quantity} uds.</span>
                            <span className="text-xs font-medium text-[#71717A]">${r.unit_cost.toFixed(2)}/ud.</span>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button type="button" onClick={() => { setEditingRestockId(r.id); setEditRestockFields({ quantity: String(r.quantity), unit_cost: String(r.unit_cost) }); }} className="p-1.5 rounded-[0.5rem] text-[#A1A1AA] hover:text-[#111111] hover:bg-[#EAEAEC] transition-colors touch-manipulation"><Pencil size={12} /></button>
                              <button type="button" onClick={() => setConfirmDeleteRestockId(r.id)} className="p-1.5 rounded-[0.5rem] text-[#A1A1AA] hover:text-red-500 hover:bg-red-50 transition-colors touch-manipulation"><Trash2 size={12} /></button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Resumen del producto */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <div className="bg-[#F9FAFA] p-4 rounded-[1.25rem] border border-[#EAEAEC] text-center"><p className="text-[10px] text-[#71717A] font-bold uppercase tracking-widest mb-1">Unidades</p><p className="text-xl font-medium text-[#111111] tracking-tight">{totalUnits}</p></div>
              <div className="bg-[#F9FAFA] p-4 rounded-[1.25rem] border border-[#EAEAEC] text-center"><p className="text-[10px] text-[#71717A] font-bold uppercase tracking-widest mb-1">Ingresos</p><p className="text-xl font-medium text-[#111111] tracking-tight">${totalRevenue.toFixed(2)}</p></div>
              <div className="bg-[#F9FAFA] p-4 rounded-[1.25rem] border border-[#EAEAEC] text-center"><p className="text-[10px] text-[#71717A] font-bold uppercase tracking-widest mb-1">Ganancia</p><p className={`text-xl font-medium tracking-tight ${totalProfit >= 0 ? 'text-[#16A34A]' : 'text-red-500'}`}>${totalProfit.toFixed(2)}</p></div>
              <div className="bg-[#F9FAFA] p-4 rounded-[1.25rem] border border-[#EAEAEC] text-center"><p className="text-[10px] text-[#71717A] font-bold uppercase tracking-widest mb-1">Margen</p><p className={`text-xl font-medium tracking-tight ${avgMargin >= 20 ? 'text-[#16A34A]' : avgMargin > 0 ? 'text-amber-600' : 'text-red-500'}`}>{avgMargin.toFixed(1)}%</p></div>
            </div>

            {/* Historial de ventas */}
            <div>
              <h4 className="text-sm font-bold uppercase tracking-widest text-[#A1A1AA] mb-4">Historial de Ventas</h4>
              {productSales.length === 0 ? (
                <p className="text-center py-8 text-[#71717A] font-medium text-sm">No hay ventas registradas para este producto.</p>
              ) : (
                <div className="space-y-2">
                  {productSales.map((sale, idx) => {
                    const margin = sale.salePrice > 0 ? ((sale.salePrice - sale.costAtSale) / sale.salePrice) * 100 : 0;
                    const prevSale = productSales[idx + 1];
                    const priceUp = prevSale ? sale.salePrice > prevSale.salePrice : null;
                    const costUp = prevSale ? sale.costAtSale > prevSale.costAtSale : null;
                    return (
                      <div key={sale.id} className="bg-[#F9FAFA] rounded-[1.25rem] border border-[#EAEAEC] p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                        <div className="flex-shrink-0 text-xs font-medium text-[#71717A] w-20">{new Date(sale.date).toLocaleDateString()}</div>
                        <div className="flex flex-1 gap-3 flex-wrap">
                          <div className="flex items-center gap-1.5 bg-white border border-[#EAEAEC] px-3 py-1.5 rounded-full">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Compra</span>
                            <span className="text-sm font-medium text-[#111111]">${sale.costAtSale.toFixed(2)}</span>
                            {costUp !== null && <span className={`text-[10px] font-bold ${costUp ? 'text-red-500' : 'text-[#16A34A]'}`}>{costUp ? '▲' : '▼'}</span>}
                          </div>
                          <div className="flex items-center gap-1.5 bg-white border border-[#EAEAEC] px-3 py-1.5 rounded-full">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Venta</span>
                            <span className="text-sm font-medium text-[#111111]">${sale.salePrice.toFixed(2)}</span>
                            {priceUp !== null && <span className={`text-[10px] font-bold ${priceUp ? 'text-[#16A34A]' : 'text-red-500'}`}>{priceUp ? '▲' : '▼'}</span>}
                          </div>
                          <div className="flex items-center gap-1.5 bg-white border border-[#EAEAEC] px-3 py-1.5 rounded-full">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Cant.</span>
                            <span className="text-sm font-medium text-[#111111]">{sale.quantity}</span>
                          </div>
                        </div>
                        <div className="flex-shrink-0 flex items-center gap-2">
                          <span className={`text-sm font-medium ${margin >= 20 ? 'text-[#16A34A]' : margin > 0 ? 'text-amber-600' : 'text-red-500'}`}>+${((sale.salePrice - sale.costAtSale) * sale.quantity).toFixed(2)}</span>
                          <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${margin >= 20 ? 'bg-[#E8F8B6]/50 text-[#4A6310]' : margin > 0 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'}`}>{margin.toFixed(0)}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Editar / Eliminar Imagen */}
            <div className="mt-6 pt-6 border-t border-[#EAEAEC]/60">
              <label className="block text-sm font-medium text-[#71717A] mb-3">Fotografía del Producto</label>
              <div className="flex flex-col sm:flex-row gap-3 items-start">
                <div
                  className={`w-24 h-24 bg-[#F9FAFA] rounded-[1.25rem] border-2 overflow-hidden flex items-center justify-center flex-shrink-0 relative transition-all ${isDraggingEdit ? 'border-[#C8F169] bg-[#E8F8B6]/30 scale-105' : 'border-[#EAEAEC]'} ${(editImagePreview || detailProduct.imageUrl) ? 'cursor-zoom-in group' : ''}`}
                  onDragOver={e => { e.preventDefault(); setIsDraggingEdit(true); }}
                  onDragLeave={() => setIsDraggingEdit(false)}
                  onDrop={async e => { e.preventDefault(); setIsDraggingEdit(false); const file = e.dataTransfer.files?.[0]; if (file && file.type.startsWith('image/')) await uploadAndSaveImage(file); }}
                  onClick={() => { const url = editImagePreview || detailProduct.imageUrl; if (url) setLightboxUrl(url); }}
                >
                  {editImagePreview ? <img src={editImagePreview} alt="preview" className="w-full h-full object-cover" /> : detailProduct.imageUrl ? <img src={detailProduct.imageUrl} alt={detailProduct.name} className="w-full h-full object-cover" /> : <span className="text-[#A1A1AA] text-xs font-medium text-center px-2">[Sin imagen]</span>}
                  {(editImagePreview || detailProduct.imageUrl) && <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center"><ZoomIn size={20} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" /></div>}
                </div>
                <div className="flex flex-col gap-2 flex-1">
                  <label
                    className={`flex items-center justify-center sm:justify-start gap-2 border-2 border-dashed px-4 py-2.5 rounded-[1rem] text-sm font-medium transition-all cursor-pointer touch-manipulation w-full ${isDraggingEdit ? 'border-[#C8F169] bg-[#E8F8B6]/20 text-[#4A6310]' : 'border-[#EAEAEC] bg-[#F9FAFA] hover:bg-[#EAEAEC] text-[#111111]'}`}
                    onDragOver={e => { e.preventDefault(); setIsDraggingEdit(true); }}
                    onDragLeave={() => setIsDraggingEdit(false)}
                    onDrop={async e => { e.preventDefault(); setIsDraggingEdit(false); const file = e.dataTransfer.files?.[0]; if (file && file.type.startsWith('image/')) await uploadAndSaveImage(file); }}
                  >
                    <ImagePlus size={15} /><span>{isDraggingEdit ? 'Suelta aquí' : 'Cambiar imagen — clic o arrastra'}</span>
                    <input type="file" accept="image/*" onChange={handleEditImageChange} className="hidden" />
                  </label>
                  {detailProduct.imageUrl && !editImagePreview && (
                    <button type="button" onClick={handleRemoveImage} className="flex items-center justify-center sm:justify-start gap-2 text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-100 px-4 py-2.5 rounded-[1rem] text-sm font-medium transition-colors touch-manipulation w-full sm:w-auto"><Trash2 size={14} /><span>Eliminar imagen</span></button>
                  )}
                  {imageSuccess && <p className="text-sm font-medium text-[#4A6310]">{imageSuccess}</p>}
                </div>
              </div>
            </div>

            {/* Zona peligrosa - Eliminar producto */}
            <div className="mt-6 pt-6 border-t border-red-100">
              {!confirmDelete ? (
                <button type="button" onClick={() => setConfirmDelete(true)} className="flex items-center gap-2 text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-100 px-5 py-3 rounded-[1.25rem] text-sm font-medium transition-colors touch-manipulation"><Trash2 size={15} /><span>Eliminar producto</span></button>
              ) : (
                <div className="bg-red-50 border border-red-200 rounded-[1.5rem] p-4 space-y-3">
                  <p className="text-sm font-medium text-red-700">¿Eliminar <span className="font-bold">{detailProduct.name}</span>? Esto borrará también todas sus ventas y reabastecimientos. Esta acción es irreversible.</p>
                  <div className="flex gap-3">
                    <button type="button" onClick={() => setConfirmDelete(false)} className="flex-1 px-4 py-2.5 text-[#71717A] hover:text-[#111111] bg-white border border-[#EAEAEC] hover:bg-[#F4F5F4] rounded-[1.25rem] font-medium transition-colors touch-manipulation text-sm">Cancelar</button>
                    <button type="button" onClick={handleDeleteProduct} className="flex-1 bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 rounded-[1.25rem] font-medium transition-all active:scale-95 touch-manipulation text-sm flex items-center justify-center gap-2"><Trash2 size={14} /><span>Sí, eliminar todo</span></button>
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>
      )}

      {/* --- Lightbox Global (Funciona en la vista de Lista y en el Detalle) --- */}
      {lightboxUrl && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in" onClick={() => setLightboxUrl(null)}>
          <button className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors touch-manipulation"><X size={22} /></button>
          <img src={lightboxUrl} alt="Imagen ampliada" className="max-w-[92vw] max-h-[88vh] rounded-[1.5rem] shadow-2xl object-contain animate-in zoom-in-90" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}