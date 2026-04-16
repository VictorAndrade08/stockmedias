"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ShoppingBag, User, X, ArrowRight, ShoppingCart, Check, ZoomIn, Search } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation'; // <-- Importado para redirección rápida

// --- INICIALIZACIÓN DE SUPABASE (ANTI-CACHÉ REDDIT 2026) ---
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY as string; 

// Forzamos 'no-store' para que Next.js y el navegador NUNCA guarden datos viejos en caché
const supabase = (supabaseUrl && supabaseKey) 
  ? createClient(supabaseUrl, supabaseKey, {
      global: {
        fetch: (url, options) => fetch(url, { ...options, cache: 'no-store' })
      }
    }) 
  : null;

// --- CONSTANTES ---
const ITEMS_PER_PAGE = 12;
const STORE_LOGO_URL = "https://pub-25cde2184a5249da96fa022aae951321.r2.dev/logo/logo.png";

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
  const router = useRouter(); // <-- Instancia del enrutador de Next.js
  
  const [allProducts, setAllProducts] = useState<StoreProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Scroll Infinito
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_PAGE);
  const loaderRef = useRef<HTMLDivElement>(null);
  
  // Carrito y Checkout
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [clientName, setClientName] = useState('');
  
  // Estados Visuales (UX)
  const [addedItems, setAddedItems] = useState<{ [key: string]: boolean }>({});
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [cartBump, setCartBump] = useState(false); 

  // --- PERSISTENCIA DEL CARRITO ---
  useEffect(() => {
    const savedCart = localStorage.getItem('wolfe_socks_cart');
    if (savedCart) {
      try {
        setCart(JSON.parse(savedCart));
      } catch (err) {
        console.error("Error al cargar el carrito persistente:", err);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('wolfe_socks_cart', JSON.stringify(cart));
  }, [cart]);

  // --- CARGA, PRIORIZACIÓN Y MEZCLA DE DATOS (CON ANTI-CACHÉ) ---
  useEffect(() => {
    const fetchProducts = async () => {
      if (!supabase) return;
      setLoading(true);

      // El .neq fuerza una query dinámica para evadir el caché estático de Next.js
      const { data, error } = await supabase
        .from('products')
        .select('id, sku, name, price, stock, image_url')
        .neq('id', '00000000-0000-0000-0000-000000000000');

      if (error) {
        console.error('Error fetching store products:', error);
      } else if (data) {
        const withPhoto = data.filter(p => p.image_url && p.image_url.trim() !== "");
        const withoutPhoto = data.filter(p => !p.image_url || p.image_url.trim() === "");

        setAllProducts([
          ...shuffleArray(withPhoto), 
          ...shuffleArray(withoutPhoto)
        ]);
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
    setVisibleCount(ITEMS_PER_PAGE);
  }, [searchTerm]);

  const displayedProducts = filteredProducts.slice(0, visibleCount);

  // --- SENSOR DE INTERSECCIÓN (SCROLL INFINITO) ---
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && visibleCount < filteredProducts.length) {
          setVisibleCount((prev) => prev + ITEMS_PER_PAGE);
        }
      },
      { threshold: 0.1 }
    );

    const currentLoader = loaderRef.current;
    if (currentLoader) {
      observer.observe(currentLoader);
    }

    return () => {
      if (currentLoader) observer.unobserve(currentLoader);
    };
  }, [visibleCount, filteredProducts.length]);

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

  // --- MOTOR DE DESCUENTOS ---
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

  // --- WHATSAPP CHECKOUT ---
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
    const whatsappNumber = "593983445421"; 
    
    window.open(`https://wa.me/${whatsappNumber}?text=${encodedMessage}`, '_blank');
  };

  return (
    <div className="min-h-screen bg-[#F4F5F4] text-[#111111] font-sans selection:bg-[#C8F169] selection:text-[#111111] relative">
      
      {/* --- NAVEGACIÓN PRINCIPAL --- */}
      <header className="sticky top-0 z-40 bg-[#F4F5F4]/90 backdrop-blur-md border-b border-[#EAEAEC]">
        <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-4 md:py-5 flex items-center justify-between">
          
          {/* COMPONENTE LOGO: Ahora direcciona al Home (/) sin recargar usando router.push */}
          <div 
            className="flex items-center gap-1.5 sm:gap-2 text-xl md:text-[1.35rem] font-bold tracking-tight text-[#1A1A1A] cursor-pointer" 
            onClick={() => router.push('/')}
          >
            <img 
              src={STORE_LOGO_URL} 
              alt="Wolfe Socks Logo" 
              className="h-10 sm:h-12 md:h-14 w-auto object-contain transition-transform hover:scale-105" 
            />
            Wolfe Socks
          </div>
          
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-[#111111]">
             {/* Enlaces futuros */}
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

      {/* --- HERO SECTION --- */}
      <section className="py-10 md:py-20 px-4 md:px-6 text-center max-w-3xl mx-auto flex flex-col items-center">
        <h1 className="text-3xl md:text-[3.5rem] font-black uppercase tracking-tighter mb-3 md:mb-4 text-[#111111]">
          ENCUENTRA TU PAR IDEAL
        </h1>
        <p className="text-sm md:text-base text-[#71717A] font-medium mb-6 md:mb-8 leading-relaxed">
          Dale personalidad a tus pasos con diseños únicos y comodidad absoluta.<br className="hidden md:block"/> Combina tus favoritos y ahorra con nuestros Precios de Locura.
        </p>
        
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

      {/* --- PRODUCT GRID --- */}
      <main className="max-w-[1400px] mx-auto px-4 md:px-6 pb-24">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-[#71717A]">
            <img src={STORE_LOGO_URL} alt="Cargando" className="w-16 h-16 md:w-20 md:h-20 object-contain animate-bounce mb-4 opacity-40 grayscale" />
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
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-3 sm:gap-x-6 gap-y-10 sm:gap-y-12">
              {displayedProducts.map((product) => (
                <div key={product.id} className="group flex flex-col h-full">
                  
                  <div 
                    className="relative w-full aspect-square bg-gradient-to-b from-[#EAEAEC] to-[#F4F5F4] rounded-2xl sm:rounded-[1.5rem] mb-3 md:mb-4 flex items-center justify-center overflow-hidden border border-[#EAEAEC]/50 shadow-sm transition-all duration-500 group-hover:shadow-md cursor-zoom-in"
                    onClick={() => setLightboxUrl(product.image_url || 'fallback')}
                  >
                    {product.image_url ? (
                      <img 
                        src={product.image_url} 
                        alt={product.name} 
                        loading="lazy"
                        className="absolute inset-0 w-full h-full object-cover mix-blend-multiply group-hover:scale-105 transition-transform duration-700 ease-out" 
                      />
                    ) : (
                      <img 
                        src={STORE_LOGO_URL} 
                        alt="Sin imagen" 
                        loading="lazy"
                        className="w-20 h-20 md:w-28 md:h-28 object-contain opacity-30 grayscale group-hover:scale-110 transition-transform duration-700" 
                      />
                    )}
                    
                    <div className="absolute top-2 right-2 md:top-3 md:right-3 bg-white/90 backdrop-blur-sm p-1.5 rounded-full text-[#111111] opacity-0 group-hover:opacity-100 transition-opacity hidden md:block shadow-sm z-20">
                      <ZoomIn size={16} />
                    </div>

                    <div 
                      className="absolute inset-x-0 bottom-0 p-2 sm:p-3 flex gap-1.5 sm:gap-2 z-20"
                      onClick={(e) => e.stopPropagation()} 
                    >
                      <button 
                        onClick={() => handleAddToCart(product, false)}
                        className={`flex-1 flex items-center justify-center gap-1 text-xs sm:text-sm font-bold py-2.5 sm:py-3 rounded-[0.75rem] shadow-sm transition-all active:scale-95 touch-manipulation ${addedItems[product.id] ? 'bg-[#E8F8B6] text-[#4A6310]' : 'bg-white text-[#111111] hover:bg-gray-50'}`}
                      >
                        {addedItems[product.id] ? <><Check size={14}/> Añadido</> : 'Añadir'}
                      </button>
                      <button 
                        onClick={() => handleAddToCart(product, true)}
                        className="flex-1 bg-[#1A1A1A] hover:bg-black text-white text-xs sm:text-sm font-bold py-2.5 sm:py-3 rounded-[0.75rem] shadow-sm transition-colors active:scale-95 touch-manipulation"
                      >
                        Comprar
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col flex-1 px-1">
                    {product.sku && (
                      <span className="font-bold text-[10px] sm:text-xs tracking-widest text-[#4A6310] bg-[#E8F8B6] px-2.5 py-0.5 rounded-full inline-block w-fit mb-1.5 border border-[#C8F169]/40">
                        #{product.sku}
                      </span>
                    )}
                    
                    <div className="flex flex-col sm:flex-row sm:justify-between items-start gap-1 sm:gap-2">
                      <h3 className="font-bold text-[#111111] text-sm sm:text-base leading-tight flex-1 line-clamp-2">
                        {product.name}
                      </h3>
                      <span className="font-black text-[#111111] text-sm sm:text-base shrink-0 mt-0.5 sm:mt-0">
                        ${product.price.toFixed(2)}
                      </span>
                    </div>
                  </div>
                  
                </div>
              ))}
            </div>

            {/* --- SENSOR DE SCROLL INFINITO --- */}
            {visibleCount < filteredProducts.length && (
              <div ref={loaderRef} className="mt-12 flex items-center justify-center py-10 w-full">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-l-2 border-[#1A1A1A]"></div>
              </div>
            )}
          </>
        )}
      </main>

      {/* --- CARRITO SLIDE-OVER --- */}
      {isCartOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity" onClick={() => setIsCartOpen(false)} />
          <div className="relative w-full md:w-[400px] h-full bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
            <div className="px-6 py-5 border-b border-[#EAEAEC] flex items-center justify-between bg-white">
              <h2 className="text-xl font-bold tracking-tight flex items-center gap-2"><ShoppingCart size={20} /> Tu Pedido</h2>
              <button onClick={() => setIsCartOpen(false)} className="p-2 bg-[#F4F5F4] hover:bg-[#EAEAEC] rounded-full transition-colors text-[#71717A] hover:text-[#111111] touch-manipulation"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {cart.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-[#71717A] space-y-4">
                  <img src={STORE_LOGO_URL} alt="Carrito vacío" className="w-20 h-20 object-contain opacity-20 grayscale" />
                  <p className="font-medium text-[#111111]">Tu carrito está vacío.</p>
                  <button onClick={() => setIsCartOpen(false)} className="text-sm font-bold text-[#71717A] hover:text-[#1A1A1A] underline decoration-2 underline-offset-4 transition-colors touch-manipulation">Seguir comprando</button>
                </div>
              ) : (
                cart.map(item => (
                  <div key={item.product.id} className="flex gap-4">
                    <div className="w-20 h-20 bg-[#F4F5F4] rounded-xl flex-shrink-0 overflow-hidden border border-[#EAEAEC] flex items-center justify-center relative">
                      {item.product.image_url ? <img src={item.product.image_url} alt={item.product.name} className="w-full h-full object-cover mix-blend-multiply" /> : <img src={STORE_LOGO_URL} alt="Sin imagen" className="w-10 h-10 object-contain opacity-30 grayscale" />}
                    </div>
                    <div className="flex flex-col justify-between flex-1">
                      <div>
                        {item.product.sku && <span className="font-black text-base tracking-wider text-[#4A6310] block mb-0.5">#{item.product.sku}</span>}
                        <h4 className="font-bold text-[#111111] text-sm line-clamp-2 leading-tight">{item.product.name}</h4>
                        <p className="text-xs font-medium text-[#71717A] mt-1">${item.product.price.toFixed(2)} base c/u</p>
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center bg-[#F4F5F4] rounded-lg p-1">
                          <button onClick={() => updateQuantity(item.product.id, -1)} className="w-8 h-8 flex items-center justify-center text-[#71717A] hover:text-[#111111] font-bold touch-manipulation">−</button>
                          <span className="w-6 text-center text-sm font-bold text-[#111111]">{item.quantity}</span>
                          <button onClick={() => updateQuantity(item.product.id, 1)} className="w-8 h-8 flex items-center justify-center text-[#71717A] hover:text-[#111111] font-bold touch-manipulation">+</button>
                        </div>
                        <button onClick={() => removeFromCart(item.product.id)} className="text-xs font-bold text-red-500 hover:text-red-700 underline decoration-red-200 underline-offset-2 p-2 touch-manipulation">Quitar</button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            {cart.length > 0 && (
              <div className="border-t border-[#EAEAEC] p-6 bg-white space-y-4">
                {savings > 0 && (
                  <div className="flex justify-between items-center text-xs font-bold text-[#4A6310] bg-[#E8F8B6]/50 px-3 py-2.5 rounded-xl border border-[#C8F169]/40">
                    <span className="flex items-center gap-1">🔥 Promo aplicada ({cartItemCount} pares)</span>
                    <span className="bg-white px-2 py-1 rounded-md shadow-sm text-[#111111]">- ${savings.toFixed(2)} ahorro</span>
                  </div>
                )}
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-[#71717A] uppercase tracking-wider">Total Pedido</span>
                  <div className="flex items-center gap-2">
                    {savings > 0 && <span className="text-base font-bold text-[#A1A1AA] line-through">${originalTotal.toFixed(2)}</span>}
                    <span className="text-2xl font-black text-[#111111] tracking-tight">${cartTotal.toFixed(2)}</span>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#71717A] uppercase tracking-wider mb-2">Tu Nombre</label>
                  <input type="text" required value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Ej. Juan Pérez" className="w-full px-4 py-3 bg-[#F4F5F4] border border-[#EAEAEC] rounded-xl focus:ring-2 focus:ring-[#1A1A1A] focus:border-[#1A1A1A] transition-all outline-none font-medium text-sm" />
                </div>
                <button onClick={handleWhatsAppCheckout} disabled={cart.length === 0} className="w-full bg-[#1A1A1A] hover:bg-black text-white py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-lg shadow-black/10 disabled:opacity-50 touch-manipulation">Continuar por WhatsApp <ArrowRight size={18} /></button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- LIGHTBOX --- */}
      {lightboxUrl && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-sm animate-in fade-in" onClick={() => setLightboxUrl(null)}>
          <button className="absolute top-4 right-4 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors touch-manipulation z-50"><X size={24} /></button>
          {lightboxUrl === 'fallback' ? (
            <div className="w-64 h-64 bg-white rounded-3xl flex items-center justify-center animate-in zoom-in-90 shadow-2xl relative" onClick={e => e.stopPropagation()}>
              <img src={STORE_LOGO_URL} alt="Sin imagen" className="w-24 h-24 object-contain opacity-20 grayscale" />
            </div>
          ) : (
            <img src={lightboxUrl} alt="Vista ampliada" className="max-w-[95vw] max-h-[90vh] rounded-2xl shadow-2xl object-contain animate-in zoom-in-90 relative" onClick={e => e.stopPropagation()} />
          )}
        </div>
      )}
    </div>
  );
}