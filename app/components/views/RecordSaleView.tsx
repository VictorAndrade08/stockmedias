"use client";

import React, { useState, useMemo } from 'react';
import { Search, DollarSign, Trash2, Plus, X, RefreshCw, Package, ImagePlus } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { Product, NewProductState, CartItem } from '../../../types';
import { NameSuggester } from '../ui/NameSuggester';
import { uploadImageToR2, generateShortCode } from '../../../lib/utils';

export function RecordSaleView({ products, userId, onRefresh }: { products: Product[]; userId?: string; onRefresh: () => void }) {
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
      ? products.filter(p => 
          p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
          (p.sku && p.sku.toLowerCase().includes(searchTerm.toLowerCase()))
        )
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
    if (!selectedProduct || !salePrice || !saleCost || quantity <= 0 || !supabase) return;
    
    const activeUserId = products.length > 0 ? (products[0] as any).user_id : userId;
    
    try {
      await supabase.from('sales').insert([{
        product_id: selectedProduct.id,
        sale_price: parseFloat(salePrice),
        cost_at_sale: parseFloat(saleCost), 
        quantity: parseInt(String(quantity)),
        date: new Date().toISOString(),
        client_name: clientName.trim() || 'Cliente Anónimo',
        user_id: activeUserId
      }]).throwOnError();
      
      await supabase.from('products')
        .update({ stock: selectedProduct.stock - parseInt(String(quantity)) })
        .eq('id', selectedProduct.id).throwOnError();
        
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
    if (!supabase) return;
    
    const activeUserId = products.length > 0 ? (products[0] as any).user_id : userId;
    
    try {
      const { data } = await supabase.from('products').insert([{
        sku: generateShortCode(), // 🔥 Vuelve la generación automática de SKU
        name: newProduct.name, 
        cost: parseFloat(newProduct.cost), 
        price: parseFloat(newProduct.price), 
        stock: parseInt(newProduct.stock), 
        image_url: newProduct.imagePreview,
        user_id: activeUserId
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

  const cartTotal = cart.reduce((s, c) => s + (parseFloat(c.salePrice) || 0) * c.quantity, 0);
  const cartProfit = cart.reduce((s, c) => s + ((parseFloat(c.salePrice) || 0) - (parseFloat(c.saleCost) || 0)) * c.quantity, 0);

  const handleConfirmCart = async () => {
    if (!cart.length || !supabase) return;
    
    const activeUserId = products.length > 0 ? (products[0] as any).user_id : userId;
    
    try {
      const saleDate = new Date().toISOString();
      for (const item of cart) {
        await supabase.from('sales').insert([{
          product_id: item.product.id,
          sale_price: parseFloat(item.salePrice),
          cost_at_sale: parseFloat(item.saleCost),
          quantity: item.quantity,
          date: saleDate,
          client_name: clientName.trim() || 'Cliente Anónimo',
          user_id: activeUserId
        }]).throwOnError();
        await supabase.from('products')
          .update({ stock: item.product.stock - item.quantity })
          .eq('id', item.product.id).throwOnError();
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
    if (!quickRestockProduct || !supabase) return;

    const activeUserId = products.length > 0 ? (products[0] as any).user_id : userId;
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
        user_id: activeUserId
      }]).throwOnError();

      await supabase.from('products').update({
        stock: currentStock + qty,
        cost: newAvgCost
      }).eq('id', quickRestockProduct.id).throwOnError();

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
              <NameSuggester imagePreview={newProduct.imagePreview} currentName={newProduct.name} existingNames={products.map(p => p.name)} onSelect={(name) => setNewProduct({ ...newProduct, name })} />
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
              <label className="flex flex-col md:flex-row items-center justify-center md:justify-start gap-3 w-full px-4 py-3 min-h-[120px] md:min-h-0 text-center md:text-left bg-[#F9FAFA] border-2 border-dashed border-[#EAEAEC] rounded-[1.25rem] hover:border-[#C8F169] hover:bg-[#E8F8B6]/10 transition-all cursor-pointer text-[#71717A] text-sm font-medium" onDragOver={e => e.preventDefault()} onDrop={async e => { e.preventDefault(); const file = e.dataTransfer.files?.[0]; if (file && file.type.startsWith('image/')) { try { const url = await uploadImageToR2(file); setNewProduct({...newProduct, imagePreview: url}); } catch(err){console.error(err);} }}}>
                <ImagePlus size={24} className="md:w-4 md:h-4" />
                <span>{newProduct.imagePreview ? '✓ Imagen lista — clic para cambiar o arrastra otra' : 'Clic para seleccionar o arrastra una imagen aquí'}</span>
                <input type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
              </label>
            </div>
            
            <div className="md:col-span-5 flex flex-col sm:flex-row justify-end mt-4 pt-4 md:pt-6 border-t border-[#EAEAEC]/60 gap-3 sticky bottom-0 bg-white p-4 -mx-4 -mb-4 md:m-0 md:p-0 md:static z-20 shadow-[0_-10px_20px_rgba(0,0,0,0.05)] md:shadow-none">
              <button type="button" onClick={() => setShowQuickAdd(false)} className="w-full sm:w-auto px-6 py-3 sm:py-3 text-[#71717A] hover:text-[#111111] bg-[#F4F5F4] hover:bg-[#EAEAEC] rounded-[1.25rem] font-medium transition-colors touch-manipulation">Cancelar</button>
              <button type="submit" className="w-full sm:w-auto bg-[#1A1A1A] hover:bg-black text-white px-8 py-3 sm:py-3 rounded-[1.25rem] transition-all font-medium shadow-md shadow-black/10 active:scale-95 touch-manipulation">Guardar y Continuar</button>
            </div>
          </form>
        ) : !selectedProduct ? (
          <>
            <div className="relative w-full mb-5">
              <label className="block text-sm font-medium text-[#71717A] mb-3">Buscar Producto (escribe el nombre o código SKU)</label>
              <div className="relative">
                <Search className="absolute left-4 top-4 text-[#A1A1AA]" size={20} />
                <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-12 pr-4 py-3.5 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" placeholder="Ej. Medias Nike o código SKU..." autoFocus />
              </div>
            </div>

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
                      <button type="button" onClick={() => setCart(cart.filter(c => c.product.id !== item.product.id))} className="p-1.5 rounded-[0.5rem] text-[#A1A1AA] hover:text-red-50 hover:bg-red-50 transition-colors touch-manipulation"><Trash2 size={16} strokeWidth={2.5} /></button>
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
                    
                    <div className="sticky bottom-4 z-20 md:static">
                      <button type="button" onClick={handleConfirmCart} disabled={cart.some(c => !c.salePrice || parseFloat(c.salePrice) <= 0)} className="w-full sm:w-auto bg-[#1A1A1A] hover:bg-black text-white px-8 py-3 rounded-[1.25rem] font-medium transition-all shadow-xl md:shadow-md shadow-black/10 active:scale-95 touch-manipulation disabled:bg-[#F4F5F4] disabled:text-[#A1A1AA] disabled:cursor-not-allowed">Confirmar Venta{cart.length > 1 ? ` (${cart.length})` : ''}</button>
                    </div>
                  </div>
                </div>
              </div>
            )}

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
                        <p className="text-sm font-medium text-[#111111] leading-tight line-clamp-2 mb-1">
                          <span className="font-bold text-[#4A6310] bg-[#E8F8B6]/50 px-1.5 py-0.5 rounded-md mr-1">#{p.sku || 'NUEVO'}</span>
                          {p.name}
                        </p>
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
          <form onSubmit={handleRecordSale} className="space-y-6 w-full relative">
            <div className="bg-[#F9FAFA] p-4 md:p-5 rounded-[1.5rem] flex flex-col md:flex-row justify-between items-start md:items-center border border-[#EAEAEC] gap-4">
              <div className="flex items-center space-x-4 w-full">
                {selectedProduct.imageUrl && <img src={selectedProduct.imageUrl} alt={selectedProduct.name} className="w-16 h-16 rounded-2xl object-cover border border-[#EAEAEC] shadow-sm flex-shrink-0" />}
                <div className="flex-1">
                  <p className="text-[10px] text-[#71717A] font-bold uppercase tracking-widest mb-1">Producto Seleccionado</p>
                  <p className="text-lg md:text-xl font-medium text-[#111111] leading-tight tracking-tight">
                    {selectedProduct.sku && <span className="font-bold text-[#4A6310] bg-[#E8F8B6]/50 px-2 py-0.5 rounded-lg mr-2">#{selectedProduct.sku}</span>}
                    {selectedProduct.name}
                  </p>
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
              <div className="bg-[#F9FAFA] p-5 rounded-[1.5rem] flex justify-between items-center border border-[#EAEAEC] mb-20 md:mb-0">
                <span className="text-[#71717A] font-medium text-sm sm:text-base">Ganancia (por unidad):</span>
                <span className={`font-medium tracking-tight text-lg sm:text-xl ${(parseFloat(salePrice) - parseFloat(saleCost)) > 0 ? 'text-[#16A34A]' : 'text-red-500'}`}>${(parseFloat(salePrice) - parseFloat(saleCost)).toFixed(2)}</span>
              </div>
            )}
            
            <div className="sticky bottom-4 z-20 md:static">
              <button type="submit" disabled={selectedProduct.stock < quantity} className="w-full bg-[#1A1A1A] text-white font-medium py-4 px-4 rounded-[1.25rem] hover:bg-black transition-all disabled:bg-[#F4F5F4] disabled:text-[#A1A1AA] disabled:border border-[#EAEAEC] disabled:cursor-not-allowed shadow-xl md:shadow-md shadow-black/10 active:scale-[0.98] touch-manipulation text-base md:text-lg">
                {selectedProduct.stock < quantity ? 'Stock Insuficiente' : 'Confirmar Venta'}
              </button>
            </div>
          </form>
        )}
        {successMsg && <div className="mt-5 p-4 bg-[#E8F8B6]/50 text-[#4A6310] border border-[#C8F169]/40 rounded-[1.25rem] text-center font-medium animate-in fade-in slide-in-from-bottom-2">{successMsg}</div>}
        {cartSuccess && <div className="mt-5 p-4 bg-[#E8F8B6]/50 text-[#4A6310] border border-[#C8F169]/40 rounded-[1.25rem] text-center font-medium animate-in fade-in slide-in-from-bottom-2">{cartSuccess}</div>}

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