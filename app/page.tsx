"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ShoppingBag, User, X, ArrowRight, ShoppingCart, Check, ZoomIn, Search, ChevronUp, Plus, Package, ChevronLeft, ChevronRight } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation'; 

// --- INICIALIZACIÓN DE SUPABASE (ANTI-CACHÉ REDDIT 2026) ---
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY as string; 

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

const shuffleArray = (array: any[]) => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

const normalizeText = (text: string) => {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
};

export default function HomePage() {
  const router = useRouter(); 
  
  const [allProducts, setAllProducts] = useState<StoreProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_PAGE);
  const loaderRef = useRef<HTMLDivElement>(null);
  
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [clientName, setClientName] = useState('');
  
  const [addedItems, setAddedItems] = useState<{ [key: string]: boolean }>({});
  // Cambiamos lightboxUrl por lightboxIndex para poder navegar entre productos
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [cartBump, setCartBump] = useState(false); 
  
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showRecoveryToast, setShowRecoveryToast] = useState(false);

  // --- PERSISTENCIA DEL CARRITO ---
  useEffect(() => {
    const savedCart = localStorage.getItem('wolfe_socks_cart');
    if (savedCart) {
      try {
        const parsedCart = JSON.parse(savedCart);
        setCart(parsedCart);
        
        if (parsedCart.length > 0) {
          setShowRecoveryToast(true);
          setTimeout(() => setShowRecoveryToast(false), 5000); 
        }
      } catch (err) {
        console.error("Error al cargar el carrito persistente:", err);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('wolfe_socks_cart', JSON.stringify(cart));
  }, [cart]);

  // --- BLOQUEO DE SCROLL MÓVIL (HACK 2026: NO PERDER LA POSICIÓN) ---
  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 500);
    };
    window.addEventListener('scroll', handleScroll);

    if (isCartOpen || lightboxIndex !== null) {
      // Guardamos la posición exacta antes de bloquear
      const scrollY = window.scrollY;
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`; // Clavamos la página en esa posición
      document.body.style.width = '100%';
      document.body.style.overflow = 'hidden';
    } else {
      // Al cerrar, leemos dónde estaba anclado y devolvemos al usuario ahí
      const scrollY = document.body.style.top;
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      document.body.style.overflow = '';
      if (scrollY) {
        window.scrollTo(0, parseInt(scrollY || '0') * -1);
      }
    }

    return () => { 
      window.removeEventListener('scroll', handleScroll);
      document.body.style.overflow = ''; 
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
    };
  }, [isCartOpen, lightboxIndex]);

  // --- CARGA DE DATOS ---
  useEffect(() => {
    const fetchProducts = async () => {
      if (!supabase) return;
      setLoading(true);

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

  // --- BÚSQUEDA ---
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

  // --- SCROLL INFINITO ---
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

  // --- CARRITO LÓGICA ---
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

  // --- MATEMÁTICAS PROMOCIONES ---
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
    const whatsappNumber = "593989022704"; 
    
    window.open(`https://wa.me/${whatsappNumber}?text=${encodedMessage}`, '_blank');
  };

  // --- LÓGICA DE BARRA DE PROGRESO ---
  const getProgressState = () => {
    if (cartItemCount < 4) {
      return { goal: 4, needed: 4 - cartItemCount, progress: (cartItemCount / 4) * 100 };
    } else if (cartItemCount < 12) {
      return { goal: 12, needed: 12 - cartItemCount, progress: (cartItemCount / 12) * 100 };
    }
    return { goal: 12, needed: 0, progress: 100 };
  };
  const promoStatus = getProgressState();

  return (
    <div className="min-h-screen bg-[#F4F5F4] text-[#111111] font-sans selection:bg-[#C8F169] selection:text-[#111111] relative pb-16 md:pb-0">
      
      {/* --- TOAST RECUPERACIÓN --- */}
      {showRecoveryToast && (
        <div className="hidden md:flex fixed top-6 left-1/2 -translate-x-1/2 z-[100] bg-[#1A1A1A] text-white px-5 py-3 rounded-full text-sm font-bold shadow-xl animate-in slide-in-from-top-4 fade-in items-center gap-3 w-auto justify-between">
          <span className="flex-1 text-center">👀 Tus medias te esperan en el carrito</span>
          <button onClick={() => setShowRecoveryToast(false)} className="text-white/60 hover:text-white p-1 touch-manipulation"><X size={16}/></button>
        </div>
      )}

      {/* --- NAVEGACIÓN --- */}
      <header className="sticky top-0 z-40 bg-[#F4F5F4]/90 backdrop-blur-md border-b border-[#EAEAEC]">
        <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-4 md:py-5 flex items-center justify-between">
          <div 
            className="flex items-center gap-0 text-xl md:text-[1.35rem] font-bold tracking-tight text-[#1A1A1A] cursor-pointer" 
            onClick={() => router.push('/')}
          >
            <img src={STORE_LOGO_URL} alt="Wolfe Socks Logo" className="h-10 sm:h-12 md:h-14 w-auto object-contain transition-transform hover:scale-105 -mr-1 sm:-mr-1.5" />
            Wolfe Socks
          </div>
          <div className="flex items-center gap-4 md:gap-5">
            <button className="text-[#111111] hover:text-[#71717A] transition-colors hidden sm:block touch-manipulation"><User size={22} /></button>
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
      <section className="py-10 md:py-20 px-4 md:px-6 text-center max-w-3xl mx-auto flex flex-col items-center z-30 relative">
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
            <button onClick={() => setSearchTerm('')} className="absolute inset-y-0 right-0 pr-4 flex items-center text-[#A1A1AA] hover:text-[#111111] transition-colors"><X size={18} /></button>
          )}

          {/* BUSCADOR PREDICTIVO VISUAL */}
          {searchTerm.trim() && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-[#EAEAEC] rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.1)] overflow-hidden z-50 max-h-[50vh] overflow-y-auto animate-in fade-in slide-in-from-top-2 text-left">
              {displayedProducts.length > 0 ? (
                <div className="p-2 space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] px-3 py-2">Resultados Rápidos</p>
                  {displayedProducts.slice(0, 5).map(product => (
                    <div 
                      key={product.id} 
                      className="flex items-center gap-3 p-2 hover:bg-[#F9FAFA] rounded-xl transition-colors cursor-pointer group/item"
                      onClick={() => { handleAddToCart(product, true); setSearchTerm(''); }}
                    >
                      <div className="w-12 h-12 bg-[#F4F5F4] rounded-lg overflow-hidden border border-[#EAEAEC] flex items-center justify-center flex-shrink-0">
                        {product.image_url ? (
                          <img src={product.image_url} alt={product.name} className="w-full h-full object-cover mix-blend-multiply" />
                        ) : (
                          <Package size={16} className="text-[#A1A1AA]" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-[#111111] truncate leading-tight">{product.name}</p>
                        <p className="text-xs font-medium text-[#71717A] mt-0.5">${product.price.toFixed(2)}</p>
                      </div>
                      <button className="opacity-100 sm:opacity-0 sm:group-hover/item:opacity-100 p-2 bg-[#1A1A1A] text-white rounded-lg transition-all active:scale-95 flex-shrink-0">
                        <Plus size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-6 text-center text-[#71717A] text-sm font-medium">
                  No encontramos resultados para "<span className="text-[#111111]">{searchTerm}</span>"
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* --- PRODUCT GRID --- */}
      <main className="max-w-[1400px] mx-auto px-4 md:px-6 pb-24 relative z-20">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-[#71717A]">
            <img src={STORE_LOGO_URL} alt="Cargando" className="w-16 h-16 md:w-20 md:h-20 object-contain animate-bounce mb-4 opacity-40 grayscale" />
            <p className="font-medium">Cargando catálogo...</p>
          </div>
        ) : displayedProducts.length === 0 ? (
          <div className="text-center py-20 text-[#71717A] font-medium flex flex-col items-center">
            <Search size={48} className="text-[#EAEAEC] mb-4" />
            <p>Sigue explorando nuestro catálogo.</p>
            <button onClick={() => setSearchTerm('')} className="mt-4 text-sm font-bold text-[#1A1A1A] underline decoration-2 underline-offset-4 transition-colors touch-manipulation">Ver todas las medias</button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-3 sm:gap-x-6 gap-y-10 sm:gap-y-12">
              {displayedProducts.map((product, index) => (
                <div key={product.id} className="group flex flex-col h-full">
                  
                  {/* FOTO 100% LIMPIA (CON ÍNDICE PARA LIGHTBOX) */}
                  <div 
                    className="relative w-full aspect-square bg-gradient-to-b from-[#EAEAEC] to-[#F4F5F4] rounded-2xl sm:rounded-[1.5rem] mb-3 md:mb-4 flex items-center justify-center overflow-hidden border border-[#EAEAEC]/50 shadow-sm transition-all duration-500 group-hover:shadow-md cursor-zoom-in"
                    onClick={() => setLightboxIndex(index)}
                  >
                    {product.image_url ? (
                      <img src={product.image_url} alt={product.name} loading="lazy" className="absolute inset-0 w-full h-full object-cover mix-blend-multiply group-hover:scale-105 transition-transform duration-700 ease-out" />
                    ) : (
                      <img src={STORE_LOGO_URL} alt="Sin imagen" loading="lazy" className="w-20 h-20 md:w-28 md:h-28 object-contain opacity-30 grayscale group-hover:scale-110 transition-transform duration-700" />
                    )}
                    
                    <div className="absolute top-2 right-2 md:top-3 md:right-3 bg-white/90 backdrop-blur-sm p-1.5 rounded-full text-[#111111] opacity-0 group-hover:opacity-100 transition-opacity hidden md:block shadow-sm z-20"><ZoomIn size={16} /></div>
                  </div>

                  {/* INFO Y BOTONES */}
                  <div className="flex flex-col flex-1 px-1">
                    {product.sku && <span className="font-bold text-[10px] sm:text-xs tracking-widest text-[#4A6310] bg-[#E8F8B6] px-2.5 py-0.5 rounded-full inline-block w-fit mb-1.5 border border-[#C8F169]/40">#{product.sku}</span>}
                    
                    <div className="flex flex-col sm:flex-row sm:justify-between items-start gap-1 sm:gap-2 mb-3">
                      <h3 className="font-bold text-[#111111] text-sm sm:text-base leading-tight flex-1 line-clamp-2">{product.name}</h3>
                      <span className="font-black text-[#111111] text-sm sm:text-base shrink-0 mt-0.5 sm:mt-0">${product.price.toFixed(2)}</span>
                    </div>

                    <div className="mt-auto flex gap-1.5 sm:gap-2 w-full pt-1" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => handleAddToCart(product, false)} className={`flex-1 flex items-center justify-center gap-1 text-xs sm:text-sm font-bold py-2.5 sm:py-3 rounded-[0.75rem] shadow-sm transition-all border active:scale-95 touch-manipulation ${addedItems[product.id] ? 'bg-[#E8F8B6] border-[#C8F169]/40 text-[#4A6310]' : 'bg-white border-[#EAEAEC] text-[#111111] hover:bg-[#F4F5F4]'}`}>
                        {addedItems[product.id] ? <><Check size={14}/> Añadido</> : 'Añadir'}
                      </button>
                      <button onClick={() => handleAddToCart(product, true)} className="flex-1 bg-[#1A1A1A] hover:bg-black text-white text-xs sm:text-sm font-bold py-2.5 sm:py-3 rounded-[0.75rem] shadow-sm transition-colors border border-[#1A1A1A] active:scale-95 touch-manipulation">Comprar</button>
                    </div>
                  </div>

                </div>
              ))}
            </div>
            {visibleCount < filteredProducts.length && (
              <div ref={loaderRef} className="mt-12 flex items-center justify-center py-10 w-full">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-l-2 border-[#1A1A1A]"></div>
              </div>
            )}
          </>
        )}
      </main>

      {/* --- BOTÓN VOLVER ARRIBA --- */}
      {showScrollTop && (
        <button 
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-[5.5rem] right-4 md:bottom-8 md:right-8 z-40 bg-white border border-[#EAEAEC] text-[#111111] p-3 md:p-4 rounded-full shadow-[0_8px_24px_rgba(0,0,0,0.1)] hover:shadow-[0_12px_30px_rgba(0,0,0,0.15)] hover:-translate-y-1 transition-all touch-manipulation animate-in fade-in zoom-in"
          aria-label="Volver arriba"
        >
          <ChevronUp size={24} />
        </button>
      )}

      {/* --- BOTÓN FLOTANTE COMPRA RÁPIDA --- */}
      {!isCartOpen && cartItemCount > 0 && (
        <div className="fixed bottom-6 md:bottom-8 inset-x-0 z-40 flex justify-center px-4 pointer-events-none animate-in slide-in-from-bottom-8 fade-in duration-300">
          <button 
            onClick={() => setIsCartOpen(true)}
            className="pointer-events-auto flex items-center gap-2.5 bg-[#1A1A1A] hover:bg-black text-white px-6 md:px-8 py-3.5 md:py-4 rounded-full font-bold shadow-[0_8px_24px_rgba(0,0,0,0.2)] md:hover:shadow-[0_12px_30px_rgba(0,0,0,0.3)] active:scale-95 md:hover:scale-105 transition-all touch-manipulation border border-black/10"
          >
            <ShoppingCart size={18} className="text-[#C8F169]" />
            <span>Completar compra</span>
            <span className="bg-[#F4F5F4] text-[#111111] px-2 py-0.5 rounded-full text-xs ml-1 shadow-sm">${cartTotal.toFixed(2)}</span>
          </button>
        </div>
      )}

      {/* --- CARRITO --- */}
      {isCartOpen && (
        <div className="fixed inset-0 z-[100] flex justify-end overflow-hidden">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity" onClick={() => setIsCartOpen(false)} />
          
          <div className="relative w-full md:w-[400px] h-full bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-300 border-l border-white/10">
            
            <div className="px-4 py-4 md:px-6 md:py-5 border-b border-[#EAEAEC] flex items-center justify-between bg-white flex-shrink-0">
              <h2 className="text-lg md:text-xl font-bold tracking-tight flex items-center gap-2"><ShoppingCart size={20} /> Tu Pedido</h2>
              <button onClick={() => setIsCartOpen(false)} className="p-2 bg-[#F4F5F4] hover:bg-[#EAEAEC] rounded-full transition-colors text-[#71717A] hover:text-[#111111] touch-manipulation"><X size={18} /></button>
            </div>

            {cart.length > 0 && (
              <div className="px-4 py-3 md:px-6 md:py-4 bg-[#F9FAFA] border-b border-[#EAEAEC] flex-shrink-0">
                <div className="flex justify-between items-end mb-1.5 md:mb-2">
                  <span className="text-xs font-bold text-[#111111]">
                    {promoStatus.progress === 100 ? '¡Promo Máxima Desbloqueada! 🥳' : `Faltan ${promoStatus.needed} pares para ahorrar más`}
                  </span>
                  {promoStatus.progress < 100 && <span className="text-[10px] font-bold text-[#A1A1AA] uppercase">{cartItemCount}/{promoStatus.goal}</span>}
                </div>
                <div className="w-full bg-[#EAEAEC] h-1.5 md:h-2 rounded-full overflow-hidden">
                  <div className="bg-[#C8F169] h-full transition-all duration-700 ease-out rounded-full" style={{ width: `${Math.min(promoStatus.progress, 100)}%` }} />
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto overscroll-none p-4 md:p-6 space-y-4 md:space-y-6">
              {cart.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-[#71717A] space-y-4">
                  <img src={STORE_LOGO_URL} alt="Carrito vacío" className="w-20 h-20 object-contain opacity-20 grayscale" />
                  <p className="font-medium text-[#111111]">Tu carrito está vacío.</p>
                  <button onClick={() => setIsCartOpen(false)} className="text-sm font-bold text-[#71717A] hover:text-[#1A1A1A] underline decoration-2 underline-offset-4 transition-colors touch-manipulation">Seguir comprando</button>
                </div>
              ) : (
                cart.map(item => (
                  <div key={item.product.id} className="flex gap-3 md:gap-4">
                    <div className="w-16 h-16 md:w-20 md:h-20 bg-[#F4F5F4] rounded-xl flex-shrink-0 overflow-hidden border border-[#EAEAEC] flex items-center justify-center relative">
                      {item.product.image_url ? <img src={item.product.image_url} alt={item.product.name} className="w-full h-full object-cover mix-blend-multiply" /> : <img src={STORE_LOGO_URL} alt="Sin imagen" className="w-10 h-10 object-contain opacity-30 grayscale" />}
                    </div>
                    <div className="flex flex-col justify-between flex-1 py-0.5">
                      <div>
                        {item.product.sku && <span className="font-black text-[10px] md:text-sm tracking-wider text-[#4A6310] block mb-0.5">#{item.product.sku}</span>}
                        <h4 className="font-bold text-[#111111] text-xs md:text-sm line-clamp-2 leading-tight">{item.product.name}</h4>
                        <p className="text-[10px] md:text-xs font-medium text-[#71717A] mt-0.5 md:mt-1">${item.product.price.toFixed(2)} base c/u</p>
                      </div>
                      <div className="flex items-center justify-between mt-1 md:mt-2">
                        <div className="flex items-center bg-[#F4F5F4] rounded-lg p-0.5 md:p-1">
                          <button onClick={() => updateQuantity(item.product.id, -1)} className="w-6 h-6 md:w-8 md:h-8 flex items-center justify-center text-[#71717A] hover:text-[#111111] font-bold touch-manipulation">−</button>
                          <span className="w-5 md:w-6 text-center text-xs md:text-sm font-bold text-[#111111]">{item.quantity}</span>
                          <button onClick={() => updateQuantity(item.product.id, 1)} className="w-6 h-6 md:w-8 md:h-8 flex items-center justify-center text-[#71717A] hover:text-[#111111] font-bold touch-manipulation">+</button>
                        </div>
                        <button onClick={() => removeFromCart(item.product.id)} className="text-[10px] md:text-xs font-bold text-red-500 hover:text-red-700 underline decoration-red-200 underline-offset-2 p-1.5 md:p-2 touch-manipulation">Quitar</button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {cart.length > 0 && (
              <div className="relative z-10 border-t border-[#EAEAEC] p-4 pb-8 md:p-6 md:pb-6 bg-white space-y-3 md:space-y-4 flex-shrink-0 shadow-[0_-16px_24px_rgba(0,0,0,0.06)]">
                {savings > 0 && (
                  <div className="flex justify-between items-center text-[10px] md:text-xs font-bold text-[#4A6310] bg-[#E8F8B6]/50 px-3 py-2 rounded-lg border border-[#C8F169]/40">
                    <span className="flex items-center gap-1">🔥 Promo ({cartItemCount} pares)</span>
                    <span className="bg-white px-2 py-0.5 md:py-1 rounded shadow-sm text-[#111111]">- ${savings.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs md:text-sm font-bold text-[#71717A] uppercase tracking-wider">Total Pedido</span>
                  <div className="flex items-center gap-2">
                    {savings > 0 && <span className="text-sm md:text-base font-bold text-[#A1A1AA] line-through">${originalTotal.toFixed(2)}</span>}
                    <span className="text-xl md:text-2xl font-black text-[#111111] tracking-tight">${cartTotal.toFixed(2)}</span>
                  </div>
                </div>
                <div>
                  <input type="text" required value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Tu Nombre (Ej. Juan Pérez)" className="w-full px-4 py-2.5 md:py-3 bg-[#F4F5F4] border border-[#EAEAEC] rounded-xl focus:ring-2 focus:ring-[#1A1A1A] focus:border-[#1A1A1A] transition-all outline-none font-medium text-sm" />
                </div>
                
                <button onClick={handleWhatsAppCheckout} disabled={cart.length === 0} className="w-full bg-[#1A1A1A] hover:bg-black text-white py-3 md:py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-lg shadow-black/10 disabled:opacity-50 touch-manipulation text-sm md:text-base">
                  Continuar por WhatsApp <ArrowRight size={16} />
                </button>
                
                <div className="hidden md:flex justify-center items-center gap-2 md:gap-3 pt-0.5 text-[8px] md:text-[9px] sm:text-[10px] font-bold text-[#A1A1AA] uppercase tracking-widest">
                  <span>🔒 Pago seguro</span>
                  <span>•</span>
                  <span>📦 Envío a todo el país</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- NUEVO LIGHTBOX INTERACTIVO (SHOPPABLE LIGHTBOX) --- */}
      {lightboxIndex !== null && displayedProducts[lightboxIndex] && (
        <div className="fixed inset-0 z-[120] flex flex-col items-center justify-center bg-black/95 backdrop-blur-sm animate-in fade-in" onClick={() => setLightboxIndex(null)}>
          
          <button className="absolute top-6 right-4 md:top-8 md:right-8 p-3 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md text-white transition-colors touch-manipulation z-[130] shadow-lg">
            <X size={24} />
          </button>

          {/* FLECHAS DE NAVEGACIÓN */}
          <button 
            onClick={(e) => { e.stopPropagation(); setLightboxIndex(prev => prev! > 0 ? prev! - 1 : displayedProducts.length - 1); }}
            className="absolute left-2 md:left-8 p-3 md:p-4 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md text-white transition-colors touch-manipulation z-[130]"
          >
            <ChevronLeft size={28} />
          </button>

          <button 
            onClick={(e) => { e.stopPropagation(); setLightboxIndex(prev => prev! < displayedProducts.length - 1 ? prev! + 1 : 0); }}
            className="absolute right-2 md:right-8 p-3 md:p-4 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md text-white transition-colors touch-manipulation z-[130]"
          >
            <ChevronRight size={28} />
          </button>

          {/* CONTENIDO DEL LIGHTBOX */}
          <div className="relative flex flex-col items-center justify-center w-full px-12 md:px-24" onClick={e => e.stopPropagation()}>
            
            {displayedProducts[lightboxIndex].image_url ? (
              <img 
                src={displayedProducts[lightboxIndex].image_url} 
                alt={displayedProducts[lightboxIndex].name} 
                className="max-w-full max-h-[60vh] md:max-h-[70vh] rounded-2xl shadow-2xl object-contain animate-in zoom-in-90" 
              />
            ) : (
              <div className="w-64 h-64 bg-white rounded-3xl flex items-center justify-center animate-in zoom-in-90 shadow-2xl">
                <img src={STORE_LOGO_URL} alt="Sin imagen" className="w-24 h-24 object-contain opacity-20 grayscale" />
              </div>
            )}

            {/* TARJETA DE COMPRA INFERIOR (RESPETA TU DISEÑO) */}
            <div className="w-full max-w-[320px] md:max-w-sm mt-6 bg-white p-4 rounded-2xl shadow-2xl flex flex-col gap-3 animate-in slide-in-from-bottom-4">
              <div className="flex justify-between items-start gap-2">
                <div>
                  {displayedProducts[lightboxIndex].sku && <span className="font-bold text-[10px] md:text-xs tracking-widest text-[#4A6310] bg-[#E8F8B6] px-2.5 py-0.5 rounded-full mb-1.5 inline-block border border-[#C8F169]/40">#{displayedProducts[lightboxIndex].sku}</span>}
                  <h3 className="font-bold text-[#111111] text-sm md:text-base leading-tight line-clamp-1">{displayedProducts[lightboxIndex].name}</h3>
                </div>
                <span className="font-black text-[#111111] text-base shrink-0">${displayedProducts[lightboxIndex].price.toFixed(2)}</span>
              </div>
              
              <div className="flex gap-2 w-full pt-1">
                <button onClick={() => handleAddToCart(displayedProducts[lightboxIndex!], false)} className={`flex-1 flex items-center justify-center gap-1 text-xs sm:text-sm font-bold py-3 rounded-xl shadow-sm transition-all border active:scale-95 touch-manipulation ${addedItems[displayedProducts[lightboxIndex!].id] ? 'bg-[#E8F8B6] border-[#C8F169]/40 text-[#4A6310]' : 'bg-white border-[#EAEAEC] text-[#111111] hover:bg-[#F4F5F4]'}`}>
                  {addedItems[displayedProducts[lightboxIndex!].id] ? <><Check size={14}/> Añadido</> : 'Añadir'}
                </button>
                <button onClick={() => { handleAddToCart(displayedProducts[lightboxIndex!], true); setLightboxIndex(null); }} className="flex-1 bg-[#1A1A1A] hover:bg-black text-white text-xs sm:text-sm font-bold py-3 rounded-xl shadow-sm transition-colors border border-[#1A1A1A] active:scale-95 touch-manipulation">
                  Comprar
                </button>
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}