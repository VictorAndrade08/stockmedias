"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { List, LayoutGrid, Plus, Search, DollarSign, X, Package, RefreshCw, CheckCircle, ImagePlus } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { Product, PendingOrder, CartItem, NewProductState } from '../../../types';
import { NameSuggester } from '../ui/NameSuggester';
import { uploadImageToR2, generateShortCode } from '../../../lib/utils';

export function PendingOrdersView({ products, userId, pendingOrders, onRefresh }: { products: Product[]; userId?: string; pendingOrders: PendingOrder[]; onRefresh: () => void }) {
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [showAdd, setShowAdd] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  
  const [cart, setCart] = useState<CartItem[]>([]);
  const [clientName, setClientName] = useState<string>('');
  const [orderPaid, setOrderPaid] = useState<string>('0');
  const [isDelivered, setIsDelivered] = useState<boolean>(false);
  const [successMsg, setSuccessMsg] = useState<string>('');
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const [showQuickAdd, setShowQuickAdd] = useState<boolean>(false);
  const [newProduct, setNewProduct] = useState<NewProductState>({ name: '', cost: '', price: '', stock: '', imagePreview: null });
  const [quickRestockProduct, setQuickRestockProduct] = useState<Product | null>(null);
  const [quickRestockFields, setQuickRestockFields] = useState({ quantity: '', unit_cost: '' });

  const [payingOrderId, setPayingOrderId] = useState<string | null>(null);
  const [addPaymentAmount, setAddPaymentAmount] = useState<string>('');

  useEffect(() => {
    if (window.innerWidth < 768) {
      setViewMode('grid');
    }
  }, []);

  const filteredProducts = useMemo<Product[]>(() => {
    const base = searchTerm
      ? products.filter(p => 
          p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
          (p.sku && p.sku.toLowerCase().includes(searchTerm.toLowerCase()))
        )
      : [...products];
    return base.sort((a, b) => b.stock - a.stock);
  }, [searchTerm, products]);

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
    } catch (err) {
      console.error(err);
      alert("Error al reabastecer el producto rápido.");
    }
  };

  const handleCreateOrder = async () => {
    if (!cart.length || !supabase) return;
    
    const activeUserId = products.length > 0 ? (products[0] as any).user_id : userId;
    
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
        user_id: activeUserId
      }]).throwOnError();

      for (const item of cart) {
        await supabase.from('products')
          .update({ stock: item.product.stock - item.quantity })
          .eq('id', item.product.id).throwOnError();
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
    if (!supabase) return;
    
    const activeUserId = products.length > 0 ? (products[0] as any).user_id : userId;
    
    try {
      const saleDate = new Date().toISOString(); 
      for (const item of order.items) {
        await supabase.from('sales').insert([{
          product_id: item.product_id,
          sale_price: item.sale_price, 
          cost_at_sale: item.cost_at_sale, 
          quantity: item.quantity,
          date: saleDate,
          client_name: order.client_name || 'Cliente Anónimo',
          user_id: activeUserId
        }]).throwOnError();
      }

      await supabase.from('pending_orders').delete().eq('id', order.id).throwOnError();
      
      onRefresh();
      setSuccessMsg('¡Pedido finalizado y pasado a Ventas!');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err) { console.error(err); alert('Error al completar pedido.'); }
  };

  const handleDeleteOrder = async (order: PendingOrder) => {
    if (!supabase) return;
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
                <button type="button" onClick={() => setShowQuickAdd(false)} className="w-full sm:w-auto px-6 py-3 text-[#71717A] hover:text-[#111111] bg-[#F4F5F4] hover:bg-[#EAEAEC] rounded-[1.25rem] font-medium transition-colors touch-manipulation">Cancelar</button>
                <button type="submit" className="w-full sm:w-auto bg-[#1A1A1A] hover:bg-black text-white px-8 py-3 rounded-[1.25rem] transition-all font-medium shadow-md shadow-black/10 active:scale-95 touch-manipulation">Guardar y Continuar</button>
              </div>
            </form>
          ) : (
            <>
              <div className="relative w-full mb-5">
                <label className="block text-sm font-medium text-[#71717A] mb-3">Buscar Producto para el Pedido</label>
                <div className="relative">
                  <Search className="absolute left-4 top-4 text-[#A1A1AA]" size={20} />
                  <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-12 pr-4 py-3.5 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" placeholder="Ej. Medias Nike o código SKU..." autoFocus />
                </div>
              </div>

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
                        <button type="button" onClick={() => setCart(cart.filter(c => c.product.id !== item.product.id))} className="p-1.5 rounded-[0.5rem] text-[#A1A1AA] hover:text-red-50 hover:bg-red-50 transition-colors touch-manipulation"><X size={14} /></button>
                      </div>
                    </div>
                  ))}
                  
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

                    <div className="flex flex-col sm:flex-row justify-end gap-3 mt-2 sticky bottom-0 bg-[#F9FAFA] p-4 -mx-4 -mb-4 md:m-0 md:p-0 md:bg-transparent z-20 shadow-[0_-10px_20px_rgba(0,0,0,0.05)] md:shadow-none border-t border-[#EAEAEC] md:border-transparent">
                      <button type="button" onClick={() => {setCart([]); setShowAdd(false);}} className="w-full sm:w-auto px-6 py-3 text-[#71717A] bg-white border border-[#EAEAEC] hover:bg-[#F4F5F4] rounded-[1.25rem] font-medium transition-colors">Cancelar</button>
                      <button type="button" onClick={() => handleCreateOrder()} disabled={cart.some(c => !c.salePrice || parseFloat(c.salePrice) <= 0)} className="w-full sm:w-auto bg-[#1A1A1A] hover:bg-black text-white px-8 py-3 rounded-[1.25rem] transition-all font-medium active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-md">Guardar Pedido Pendiente</button>
                    </div>
                  </div>

                </div>
              )}

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
          )}
        </div>
      )}

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

      {lightboxUrl && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in" onClick={() => setLightboxUrl(null)}>
          <button className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors touch-manipulation"><X size={22} /></button>
          <img src={lightboxUrl} alt="Imagen ampliada" className="max-w-[92vw] max-h-[88vh] rounded-[1.5rem] shadow-2xl object-contain animate-in zoom-in-90" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}