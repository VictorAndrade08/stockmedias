"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ShoppingBag, User, Package, ChevronLeft, ChevronRight, X, ArrowRight, ShoppingCart, Check, ZoomIn, Search } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

// --- INICIALIZACIÓN DE SUPABASE ---
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY as string; 
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// --- TIPOS ---
interface StoreProduct {
  id: string;
  sku: string | null;
  name: string;
  price: number;
  stock: number;
  image_url: string | null;
}

interface CartItem {
  product: StoreProduct;
  quantity: number;
}

const ITEMS_PER_PAGE = 8;

// --- SVG PERSONALIZADO: MEDIA/CALCETÍN ---
const SockIcon = ({ className = "", size = 24 }: { className?: string, size?: number }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <path d="M12 3v12.5a3.5 3.5 0 0 1-7 0v-2.5" />
    <path d="M12 3h4c1.1 0 2 .9 2 2v6" />
    <path d="M18 11v1.5a3.5 3.5 0 0 1-7 0" />
    <path d="M5 8h14" />
  </svg>
);

// --- FUNCIÓN MEZCLADORA (SHUFFLE) ---
const shuffleArray = (array: any[]) => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

// --- FUNCIÓN LIMPIADORA PARA BÚSQUEDA ---
const normalizeText = (text: string) => {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
};

export default function TiendaPage() {
  const [allProducts, setAllProducts] = useState<StoreProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Paginación Cliente
  const [currentPage, setCurrentPage] = useState(1);
  
  // Carrito y Checkout
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [clientName, setClientName] = useState('');
  
  // Estados Visuales (UX)
  const [addedItems, setAddedItems] = useState<{ [key: string]: boolean }>({});
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [cartBump, setCartBump] = useState(false); 

  // --- CARGA Y MEZCLA DE DATOS ---
  useEffect(() => {
    const fetchProducts = async () => {
      if (!supabase) return;
      setLoading(true);

      const { data, error } = await supabase
        .from('products')
        .select('id, sku, name, price, stock, image_url');

      if (error) {
        console.error('Error fetching store products:', error);
      } else if (data) {
        setAllProducts(shuffleArray(data));
      }
      setLoading(false);
    };

    fetchProducts();
  }, []);

  // --- LÓGICA DE BÚSQUEDA INSTANTÁNEA ---
  const filteredProducts = useMemo(() => {
    if (!searchTerm.trim()) return allProducts;
    
    const normalizedSearch = normalizeText(searchTerm);
    return allProducts.filter(product => {
      const normalizedName = normalizeText(product.name);
      const normalizedSku = product.sku ? normalizeText(product.sku) : '';
      return normalizedName.includes(normalizedSearch) || normalizedSku.includes(normalizedSearch);
    });
  }, [allProducts, searchTerm]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  const totalProducts = filteredProducts.length;
  const totalPages = Math.ceil(totalProducts / ITEMS_PER_PAGE);
  
  const displayedProducts = filteredProducts.slice(
    (currentPage - 1) * ITEMS_PER_PAGE, 
    currentPage * ITEMS_PER_PAGE
  );

  // --- LÓGICA DEL CARRITO ---
  const handleAddToCart = useCallback((product: StoreProduct, openCart: boolean = false) => {
    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      if (existing) {
        return prev.map(item => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { product, quantity: 1 }];
    });

    if (openCart) {
      setIsCartOpen(true);
    } else {
      setAddedItems(prev => ({ ...prev, [product.id]: true }));
      setTimeout(() => setAddedItems(prev => ({ ...prev, [product.id]: false })), 1500);
    }
  }, []);

  const cartItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  
  useEffect(() => {
    if (cartItemCount > 0) {
      setCartBump(true);
      const timer = setTimeout(() => setCartBump(false), 300);
      return () => clearTimeout(timer);
    }
  }, [cartItemCount]);

  const updateQuantity = (productId: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.product.id === productId) {
        const newQty = item.quantity + delta;
        if (newQty > 0) {
          return { ...item, quantity: newQty };
        }
      }
      return item;
    }));
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(item => item.product.id !== productId));
  };

  // --- MOTOR DE DESCUENTOS (Precios de Locura Mix & Match) ---
  const originalTotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
  }, [cart]);

  const cartTotal = useMemo(() => {
    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    
    const promos12 = Math.floor(totalItems / 12);
    const remainder12 = totalItems % 12;
    
    const promos4 = Math.floor(remainder12 / 4);
    const singles = remainder12 % 4;

    return (promos12 * 22) + (promos4 * 11) + (singles * 3.5);
  }, [cart]);

  const savings = originalTotal - cartTotal;

  // --- WHATSAPP CHECKOUT (TEXTO PERSONALIZADO) ---
  const handleWhatsAppCheckout = () => {
    if (!clientName.trim()) {
      alert("Por favor ingresa tu nombre para continuar.");
      return;
    }
    if (cart.length === 0) return;

    let message = `Hola, soy *${clientName.trim()}*. Compré en el sitio web, esta es mi compra:\n\n`;
    
    cart.forEach(item => {
      const skuText = item.product.sku ? `*[REF: #${item.product.sku}]* ` : '';
      message += `▪️ ${item.quantity}x ${skuText}${item.product.name}\n`;
    });

    message += `\n📦 *Total pares:* ${cartItemCount}`;
    if (savings > 0) {
      message += `\n🎁 *Ahorro Promo:* $${savings.toFixed(2)}`;
    }
    message += `\n💰 *Total a pagar: $${cartTotal.toFixed(2)}*\n\nPor favor cotiza o envía eso quiero.`;

    const encodedMessage = encodeURIComponent(message);
    
    // NÚMERO DE WHATSAPP CONFIGURADO
    const whatsappNumber = "593983445421"; 
    
    window.open(`https://wa.me/${whatsappNumber}?text=${encodedMessage}`, '_blank');
  };

  return (
    <div className="min-h-screen bg-[#F4F5F4] text-[#111111] font-sans selection:bg-[#C8F169] selection:text-[#111111] relative">
      
      {/* --- NAVEGACIÓN PRINCIPAL --- */}
      <header className="sticky top-0 z-40 bg-[#F4F5F4]/90 backdrop-blur-md border-b border-[#EAEAEC]">
        <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-4 md:py-5 flex items-center justify-between">
          <div className="flex items-center gap-2 md:gap-3 text-lg md:text-xl font-bold tracking-tight text-[#1A1A1A] cursor-pointer" onClick={() => window.scrollTo(0,0)}>
            <Package className="text-[#1A1A1A]" strokeWidth={2.5} /> Wolfe Socks
          </div>
          
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-[#111111]">
             {/* Enlaces reservados para el futuro */}
          </nav>

          <div className="flex items-center gap-4 md:gap-5">
            <button className="text-[#111111] hover:text-[#71717A] transition-colors hidden sm:block touch-manipulation">
              <User size={22} />
            </button>
            <button 
              className={`text-[#111111] hover:text-[#71717A] transition-all relative touch-manipulation duration-300 ${cartBump ? 'scale-125' : 'scale-100'}`}
              onClick={() => setIsCartOpen(true)}
            >
              <ShoppingBag size={22} />
              {cartItemCount > 0 && (
                <span className="absolute -top-1.5 -right-2 bg-[#1A1A1A] text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center animate-in zoom-in shadow-sm shadow-black/20">
                  {cartItemCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* --- HERO SECTION CON BÚSQUEDA INTELIGENTE --- */}
      <section className="py-10 md:py-20 px-4 md:px-6 text-center max-w-3xl mx-auto flex flex-col items-center">
        <h1 className="text-3xl md:text-[3.5rem] font-black uppercase tracking-tighter mb-3 md:mb-4 text-[#111111]">
          BEST SELLERS
        </h1>
        <p className="text-sm md:text-base text-[#71717A] font-medium mb-6 md:mb-8">
          Nuestras medias más amadas, en las que confías para la comodidad<br className="hidden md:block"/> y el estilo de todos los días.
        </p>
        
        {/* Barra de búsqueda instantánea */}
        <div className="relative w-full max-w-md group">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <Search size={20} className="text-[#A1A1AA] group-focus-within:text-[#1A1A1A] transition-colors" />
          </div>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar modelo o código (Ej: #32N4U)..."
            className="w-full pl-12 pr-4 py-3.5 md:py-4 bg-white border border-[#EAEAEC] rounded-2xl focus:ring-2 focus:ring-[#1A1A1A] focus:border-[#1A1A1A] transition-all outline-none font-medium text-sm md:text-base shadow-[0_4px_24px_rgba(0,0,0,0.02)]"
          />
          {searchTerm && (
            <button 
              onClick={() => setSearchTerm('')}
              className="absolute inset-y-0 right-0 pr-4 flex items-center text-[#A1A1AA] hover:text-[#111111] transition-colors"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </section>

      {/* --- PRODUCT GRID (MÓVIL = 2 COLUMNAS) --- */}
      <main className="max-w-[1400px] mx-auto px-4 md:px-6 pb-24">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-[#71717A]">
            <SockIcon size={40} className="animate-bounce mb-4 text-[#A1A1AA]" />
            <p className="font-medium">Cargando catálogo...</p>
          </div>
        ) : displayedProducts.length === 0 ? (
          <div className="text-center py-20 text-[#71717A] font-medium flex flex-col items-center">
            <Search size={48} className="text-[#EAEAEC] mb-4" />
            <p>No se encontraron modelos para "<strong>{searchTerm}</strong>".</p>
            <button 
              onClick={() => setSearchTerm('')}
              className="mt-4 text-sm font-bold text-[#1A1A1A] underline decoration-2 underline-offset-4 transition-colors"
            >
              Ver todo el catálogo
            </button>
          </div>
        ) : (
          <>
            {/* GRID RESPONSIVE: grid-cols-2 en móvil, grid-cols-3/4 en escritorio */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-3 sm:gap-x-6 gap-y-8 sm:gap-y-12">
              {displayedProducts.map((product) => (
                <div key={product.id} className="group flex flex-col">
                  
                  {/* Contenedor de Imagen */}
                  <div 
                    className="relative w-full aspect-square bg-gradient-to-b from-[#EAEAEC] to-[#F4F5F4] rounded-2xl sm:rounded-[1.5rem] mb-3 md:mb-4 flex items-center justify-center overflow-hidden border border-[#EAEAEC]/50 shadow-sm transition-all duration-500 group-hover:shadow-md cursor-zoom-in"
                    onClick={() => setLightboxUrl(product.image_url || 'fallback')}
                  >
                    {product.image_url ? (
                      <img 
                        src={product.image_url} 
                        alt={product.name} 
                        className="w-full h-full object-cover mix-blend-multiply group-hover:scale-105 transition-transform duration-700 ease-out" 
                      />
                    ) : (
                      <SockIcon size={48} className="text-[#A1A1AA]/50 group-hover:scale-110 transition-transform duration-700" />
                    )}
                    
                    {/* Lupa discreta */}
                    <div className="absolute top-2 right-2 md:top-3 md:right-3 bg-white/80 backdrop-blur-sm p-1.5 rounded-full text-[#111111] opacity-0 group-hover:opacity-100 transition-opacity hidden md:block shadow-sm">
                      <ZoomIn size={16} />
                    </div>

                    {/* Hover Actions (Desktop) */}
                    <div 
                      className="absolute inset-x-0 bottom-0 p-3 md:p-4 opacity-0 translate-y-4 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300 hidden md:flex gap-2"
                      onClick={(e) => e.stopPropagation()} 
                    >
                      <button 
                        onClick={() => handleAddToCart(product, false)}
                        className={`flex-1 flex items-center justify-center gap-1 text-sm font-bold py-3 rounded-xl shadow-sm transition-all active:scale-95 ${addedItems[product.id] ? 'bg-[#E8F8B6] text-[#4A6310]' : 'bg-white/90 backdrop-blur-md hover:bg-white text-[#111111]'}`}
                      >
                        {addedItems[product.id] ? <><Check size={16}/> Añadido</> : 'Añadir'}
                      </button>
                      <button 
                        onClick={() => handleAddToCart(product, true)}
                        className="flex-1 bg-[#1A1A1A] hover:bg-black text-white text-sm font-bold py-3 rounded-xl shadow-sm transition-colors active:scale-95"
                      >
                        Comprar
                      </button>
                    </div>
                  </div>

                  {/* Info del Producto Adaptada para Móvil */}
                  <div className="flex flex-col gap-1 mb-1">
                    {product.sku && (
                      <span className="font-black text-xs sm:text-xl tracking-wider text-[#4A6310] bg-[#E8F8B6] px-2 sm:px-3 py-0.5 sm:py-1 rounded-md sm:rounded-[0.75rem] inline-block w-fit border border-[#C8F169]/50 shadow-sm mb-1">
                        #{product.sku}
                      </span>
                    )}
                    <div className="flex flex-col sm:flex-row sm:justify-between items-start gap-1 sm:gap-2">
                      <h3 className="font-bold text-[#111111] text-sm sm:text-base md:text-lg leading-tight flex-1 line-clamp-2">
                        {product.name}
                      </h3>
                      <span className="font-black text-[#111111] text-sm sm:text-base bg-[#F4F5F4] px-2 py-1 rounded-lg self-start sm:self-auto">
                        ${product.price.toFixed(2)}
                      </span>
                    </div>
                  </div>
                  
                  <div className="flex justify-end items-center mt-2 flex-1 items-end">
                    {/* Acciones (Mobile) */}
                    <button 
                      onClick={() => handleAddToCart(product, true)}
                      className="md:hidden w-full bg-[#1A1A1A] text-white text-xs sm:text-sm font-bold px-2 py-2.5 sm:py-3 rounded-lg sm:rounded-xl active:scale-95 shadow-md touch-manipulation"
                    >
                      Comprar
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* --- PAGINACIÓN --- */}
            {totalPages > 1 && (
              <div className="mt-16 md:mt-20 flex items-center justify-center gap-3 md:gap-4">
                <button 
                  onClick={() => { setCurrentPage(p => Math.max(1, p - 1)); window.scrollTo({top: 0, behavior: 'smooth'}); }}
                  disabled={currentPage === 1}
                  className="w-10 h-10 md:w-12 md:h-12 flex items-center justify-center rounded-full bg-white border border-[#EAEAEC] text-[#111111] hover:border-[#1A1A1A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation shadow-sm"
                >
                  <ChevronLeft size={20} />
                </button>
                <span className="text-xs md:text-sm font-bold text-[#111111]">
                  Página {currentPage} de {totalPages}
                </span>
                <button 
                  onClick={() => { setCurrentPage(p => Math.min(totalPages, p + 1)); window.scrollTo({top: 0, behavior: 'smooth'}); }}
                  disabled={currentPage === totalPages}
                  className="w-10 h-10 md:w-12 md:h-12 flex items-center justify-center rounded-full bg-white border border-[#EAEAEC] text-[#111111] hover:border-[#1A1A1A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation shadow-sm"
                >
                  <ChevronRight size={20} />
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {/* --- CARRITO SLIDE-OVER (SIDEBAR) --- */}
      {isCartOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
            onClick={() => setIsCartOpen(false)}
          />
          
          {/* Drawer */}
          <div className="relative w-full md:w-[400px] h-full bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
            
            {/* Header del Carrito */}
            <div className="px-6 py-5 border-b border-[#EAEAEC] flex items-center justify-between bg-white">
              <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
                <ShoppingCart size={20} /> Tu Pedido
              </h2>
              <button 
                onClick={() => setIsCartOpen(false)}
                className="p-2 bg-[#F4F5F4] hover:bg-[#EAEAEC] rounded-full transition-colors text-[#71717A] hover:text-[#111111] touch-manipulation"
              >
                <X size={18} />
              </button>
            </div>

            {/* Items del Carrito */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {cart.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-[#71717A] space-y-4">
                  <SockIcon size={48} className="text-[#EAEAEC]" />
                  <p className="font-medium text-[#111111]">Tu carrito está vacío.</p>
                  <button 
                    onClick={() => setIsCartOpen(false)}
                    className="text-sm font-bold text-[#71717A] hover:text-[#1A1A1A] underline decoration-2 underline-offset-4 transition-colors touch-manipulation"
                  >
                    Seguir comprando
                  </button>
                </div>
              ) : (
                cart.map(item => (
                  <div key={item.product.id} className="flex gap-4">
                    {/* Imagen miniatura */}
                    <div className="w-20 h-20 bg-[#F4F5F4] rounded-xl flex-shrink-0 overflow-hidden border border-[#EAEAEC] flex items-center justify-center">
                      {item.product.image_url ? (
                        <img src={item.product.image_url} alt={item.product.name} className="w-full h-full object-cover mix-blend-multiply" />
                      ) : (
                        <SockIcon size={24} className="text-[#A1A1AA]" />
                      )}
                    </div>
                    
                    {/* Info */}
                    <div className="flex flex-col justify-between flex-1">
                      <div>
                        {/* SKU grande también en el carrito */}
                        {item.product.sku && (
                          <span className="font-black text-base tracking-wider text-[#4A6310] block mb-0.5">
                            #{item.product.sku}
                          </span>
                        )}
                        <h4 className="font-bold text-[#111111] text-sm line-clamp-2 leading-tight">
                          {item.product.name}
                        </h4>
                        <p className="text-xs font-medium text-[#71717A] mt-1">
                          ${item.product.price.toFixed(2)} base c/u
                        </p>
                      </div>
                      
                      {/* Controles de Cantidad */}
                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center bg-[#F4F5F4] rounded-lg p-1">
                          <button onClick={() => updateQuantity(item.product.id, -1)} className="w-8 h-8 flex items-center justify-center text-[#71717A] hover:text-[#111111] font-bold touch-manipulation">−</button>
                          <span className="w-6 text-center text-sm font-bold text-[#111111]">{item.quantity}</span>
                          <button onClick={() => updateQuantity(item.product.id, 1)} className="w-8 h-8 flex items-center justify-center text-[#71717A] hover:text-[#111111] font-bold touch-manipulation">+</button>
                        </div>
                        <button onClick={() => removeFromCart(item.product.id)} className="text-xs font-bold text-red-500 hover:text-red-700 underline decoration-red-200 underline-offset-2 p-2 touch-manipulation">
                          Quitar
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer / Checkout */}
            {cart.length > 0 && (
              <div className="border-t border-[#EAEAEC] p-6 bg-white space-y-4">
                
                {/* Banner de Promoción Dinámico */}
                {savings > 0 && (
                  <div className="flex justify-between items-center text-xs font-bold text-[#4A6310] bg-[#E8F8B6]/50 px-3 py-2.5 rounded-xl border border-[#C8F169]/40">
                    <span className="flex items-center gap-1">🔥 Promo aplicada ({cartItemCount} pares)</span>
                    <span className="bg-white px-2 py-1 rounded-md shadow-sm text-[#111111]">- ${savings.toFixed(2)} ahorro</span>
                  </div>
                )}

                {/* Resumen Total */}
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-[#71717A] uppercase tracking-wider">Total Pedido</span>
                  <div className="flex items-center gap-2">
                    {savings > 0 && (
                      <span className="text-base font-bold text-[#A1A1AA] line-through">${originalTotal.toFixed(2)}</span>
                    )}
                    <span className="text-2xl font-black text-[#111111] tracking-tight">${cartTotal.toFixed(2)}</span>
                  </div>
                </div>

                {/* Formulario Cliente */}
                <div>
                  <label className="block text-xs font-bold text-[#71717A] uppercase tracking-wider mb-2">Tu Nombre</label>
                  <input 
                    type="text" 
                    required
                    value={clientName} 
                    onChange={e => setClientName(e.target.value)} 
                    placeholder="Ej. Juan Pérez" 
                    className="w-full px-4 py-3 bg-[#F4F5F4] border border-[#EAEAEC] rounded-xl focus:ring-2 focus:ring-[#1A1A1A] focus:border-[#1A1A1A] transition-all outline-none font-medium text-sm"
                  />
                </div>

                {/* Botón WhatsApp */}
                <button 
                  onClick={handleWhatsAppCheckout}
                  disabled={cart.length === 0}
                  className="w-full bg-[#1A1A1A] hover:bg-black text-white py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-lg shadow-black/10 disabled:opacity-50 touch-manipulation"
                >
                  Continuar por WhatsApp <ArrowRight size={18} />
                </button>
                <p className="text-[10px] font-medium text-center text-[#A1A1AA]">
                  El pago y envío se coordinan de forma segura por WhatsApp.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- LIGHTBOX (IMAGEN EN GRANDE) --- */}
      {lightboxUrl && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-sm animate-in fade-in" onClick={() => setLightboxUrl(null)}>
          <button className="absolute top-4 right-4 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors touch-manipulation">
            <X size={24} />
          </button>
          
          {lightboxUrl === 'fallback' ? (
            <div className="w-64 h-64 bg-white rounded-3xl flex items-center justify-center animate-in zoom-in-90 shadow-2xl" onClick={e => e.stopPropagation()}>
              <SockIcon size={120} className="text-[#EAEAEC]" />
            </div>
          ) : (
            <img 
              src={lightboxUrl} 
              alt="Vista ampliada" 
              className="max-w-[95vw] max-h-[90vh] rounded-2xl shadow-2xl object-contain animate-in zoom-in-90" 
              onClick={e => e.stopPropagation()} 
            />
          )}
        </div>
      )}
    </div>
  );
}