"use client";

import React, { useState } from 'react';
import { List, LayoutGrid, Plus, Search, Package, Trash2, Pencil, X, RefreshCw, ImagePlus, ZoomIn, DollarSign } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { Product, Sale, Restock, NewProductState } from '../../../types';
import { NameSuggester } from '../ui/NameSuggester';
import { uploadImageToR2, generateShortCode, deleteImageFromR2 } from '../../../lib/utils';

export function InventoryView({ products, userId, sales, restocks, onRefresh }: { products: Product[]; userId?: string; sales: Sale[]; restocks: Restock[]; onRefresh: () => void }) {
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

  const [quickDeleteId, setQuickDeleteId] = useState<string | null>(null);

  const handleQuickDeleteProduct = async (product: Product) => {
    if (!supabase) return;
    try {
      if (product.imageUrl) {
        await deleteImageFromR2(product.imageUrl);
      }
      await supabase.from('sales').delete().eq('product_id', product.id).throwOnError();
      await supabase.from('restocks').delete().eq('product_id', product.id).throwOnError();
      // FIX: Eliminamos el chequeo de usuario para que no falle en silencio
      await supabase.from('products').delete().eq('id', product.id).throwOnError();
      
      setQuickDeleteId(null);
      onRefresh();
    } catch (err: any) { 
      console.error("Error eliminando producto:", err); 
      alert("Hubo un error al eliminar. Revisa la consola: " + err.message);
    }
  };

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
    if (!supabase) return;
    const existingProduct = products.find(p => p.name.toLowerCase().trim() === newProduct.name.toLowerCase().trim());
    try {
      if (existingProduct) {
        await supabase.from('products').update({ 
          stock: existingProduct.stock + parseInt(newProduct.stock), 
          cost: parseFloat(newProduct.cost), 
          price: parseFloat(newProduct.price) 
        }).eq('id', existingProduct.id).throwOnError();
      } else {
        await supabase.from('products').insert([{ 
          sku: generateShortCode(),
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
    if (!detailProduct || !supabase || !editName.trim()) return;
    try {
      // FIX: Eliminamos el chequeo de usuario para que guarde de verdad en la base
      await supabase.from('products').update({ name: editName.trim() }).eq('id', detailProduct.id).throwOnError();
      setDetailProduct({ ...detailProduct, name: editName.trim() });
      setEditNameSuccess('¡Nombre actualizado!');
      setTimeout(() => setEditNameSuccess(''), 3000);
      onRefresh(); 
    } catch (err) { console.error(err); alert("Error al guardar nombre"); }
  };

  const handleRestock = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!detailProduct || !supabase) return;
    const qty = parseInt(restockFields.quantity);
    const unitCost = parseFloat(restockFields.unit_cost);
    try {
      const currentStock = detailProduct.stock;
      const currentCost = detailProduct.avg_cost ?? detailProduct.cost;
      const newAvgCost = currentStock + qty > 0
        ? ((currentStock * currentCost) + (qty * unitCost)) / (currentStock + qty)
        : unitCost;
      await supabase.from('restocks').insert([{ product_id: detailProduct.id, quantity: qty, unit_cost: unitCost, date: new Date().toISOString(), user_id: userId }]).throwOnError();
      
      await supabase.from('products').update({ stock: currentStock + qty, cost: newAvgCost, avg_cost: newAvgCost }).eq('id', detailProduct.id).throwOnError();
      
      setDetailProduct({ ...detailProduct, stock: currentStock + qty, cost: newAvgCost, avg_cost: newAvgCost });
      setRestockFields({ quantity: '', unit_cost: '' });
      setShowRestock(false);
      setRestockSuccess(`¡Reabastecido! Costo promedio actualizado a $${newAvgCost.toFixed(2)}`);
      setTimeout(() => setRestockSuccess(''), 4000);
      onRefresh();
    } catch (err) { console.error(err); alert("Error reabasteciendo"); }
  };

  const handleSaveAlert = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!detailProduct || !supabase) return;
    const alertVal = editAlert === '' ? null : parseInt(editAlert);
    try {
      await supabase.from('products').update({ stock_alert: alertVal }).eq('id', detailProduct.id).throwOnError();
      setDetailProduct({ ...detailProduct, stock_alert: alertVal });
      setAlertSuccess('¡Alerta guardada!');
      setTimeout(() => setAlertSuccess(''), 3000);
      onRefresh();
    } catch (err) { console.error(err); alert("Error guardando alerta"); }
  };

  const handleDeleteProduct = async () => {
    if (!detailProduct || !supabase) return;
    try {
      if (detailProduct.imageUrl) {
        await deleteImageFromR2(detailProduct.imageUrl);
      }
      await supabase.from('sales').delete().eq('product_id', detailProduct.id).throwOnError();
      await supabase.from('restocks').delete().eq('product_id', detailProduct.id).throwOnError();
      
      await supabase.from('products').delete().eq('id', detailProduct.id).throwOnError();
      
      setDetailProduct(null);
      onRefresh();
    } catch (err: any) { 
      console.error("Error eliminando producto:", err); 
      alert("Hubo un error al eliminar. Revisa la consola: " + err.message);
    }
  };

  const uploadAndSaveImage = async (file: File) => {
    if (!detailProduct || !supabase) return;
    try {
      if (detailProduct.imageUrl) {
        await deleteImageFromR2(detailProduct.imageUrl);
      }
      const url = await uploadImageToR2(file);
      await supabase.from('products').update({ image_url: url }).eq('id', detailProduct.id).throwOnError();
      setDetailProduct({ ...detailProduct, image_url: url, imageUrl: url });
      setEditImagePreview(url);
      setImageSuccess('¡Imagen actualizada!');
      setTimeout(() => setImageSuccess(''), 3000);
      onRefresh();
    } catch (err) { console.error(err); alert("Error guardando imagen"); }
  };

  const handleEditImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadAndSaveImage(file);
  };

  const handleRemoveImage = async () => {
    if (!detailProduct || !supabase) return;
    try {
      if (detailProduct.imageUrl) {
        await deleteImageFromR2(detailProduct.imageUrl);
      }
      await supabase.from('products').update({ image_url: null }).eq('id', detailProduct.id).throwOnError();
      setDetailProduct({ ...detailProduct, image_url: null, imageUrl: null });
      setEditImagePreview(null);
      setImageSuccess('¡Imagen eliminada!');
      setTimeout(() => setImageSuccess(''), 3000);
      onRefresh();
    } catch (err) { console.error(err); alert("Error eliminando imagen"); }
  };

  const handleSaveRestock = async (restockId: string) => {
    if (!detailProduct || !supabase) return;
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
        await supabase.from('products').update({ avg_cost: newAvg, cost: newAvg, stock: totalQty }).eq('id', detailProduct.id).throwOnError();
        setDetailProduct({ ...detailProduct, avg_cost: newAvg, cost: newAvg, stock: totalQty });
      }
      setEditingRestockId(null);
      onRefresh();
    } catch (err) { console.error(err); alert("Error actualizando reabastecimiento"); }
  };

  const handleDeleteRestock = async (restockId: string, restockQty: number) => {
    if (!detailProduct || !supabase) return;
    try {
      await supabase.from('restocks').delete().eq('id', restockId).throwOnError();
      const newStock = Math.max(0, detailProduct.stock - restockQty);
      const { data: allRestocks } = await supabase.from('restocks').select('*').eq('product_id', detailProduct.id);
      const remaining = (allRestocks || []) as Restock[];
      const totalQty = remaining.reduce((s, r) => s + r.quantity, 0);
      const totalCost = remaining.reduce((s, r) => s + r.quantity * r.unit_cost, 0);
      const newAvg = totalQty > 0 ? totalCost / totalQty : detailProduct.cost;
      await supabase.from('products').update({ stock: newStock, avg_cost: newAvg, cost: newAvg }).eq('id', detailProduct.id).throwOnError();
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
            <NameSuggester imagePreview={newProduct.imagePreview} currentName={newProduct.name} existingNames={products.map(p => p.name)} onSelect={(name) => setNewProduct({ ...newProduct, name })} />
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
            <div key={product.id} onClick={() => handleOpenDetail(product)} className="bg-white p-5 rounded-[2rem] shadow-[0_4px_24px_rgba(0,0,0,0.02)] border border-[#EAEAEC] hover:shadow-[0_8px_30px_rgb(0,0,0,0.06)] transition-all duration-300 flex flex-col h-full cursor-pointer active:scale-[0.98]">
              <div className="flex justify-between items-start mb-5 gap-2">
                <div className="flex-1">
                  <h3 className="font-medium text-[#111111] text-base md:text-lg leading-tight tracking-tight">
                    {product.sku && <span className="font-bold text-[#4A6310] bg-[#E8F8B6]/50 px-2 py-0.5 rounded-lg mr-2 inline-block mb-1">#{product.sku}</span>}
                    <span className="align-middle">{product.name}</span>
                  </h3>
                </div>
                {quickDeleteId === product.id ? (
                  <div className="flex items-center gap-1.5 bg-red-50 px-2 py-1 rounded-full animate-in fade-in">
                    <button onClick={(e) => { e.stopPropagation(); handleQuickDeleteProduct(product); }} className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold rounded-full transition-colors">BORRAR</button>
                    <button onClick={(e) => { e.stopPropagation(); setQuickDeleteId(null); }} className="px-2.5 py-1 bg-white border border-[#EAEAEC] text-[#71717A] text-[10px] font-bold rounded-full transition-colors">X</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-full flex-shrink-0 ${product.stock > 10 ? 'bg-[#E8F8B6]/50 text-[#4A6310]' : product.stock > 0 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'}`}>{product.stock} en stock</span>
                    <button onClick={(e) => { e.stopPropagation(); setQuickDeleteId(product.id); }} className="p-1.5 text-[#A1A1AA] hover:text-red-500 bg-[#F9FAFA] border border-[#EAEAEC] hover:bg-red-50 hover:border-red-200 rounded-full transition-colors touch-manipulation">
                      <Trash2 size={13} strokeWidth={2.5} />
                    </button>
                  </div>
                )}
              </div>
              <div className="w-full h-40 bg-[#F9FAFA] rounded-[1.25rem] mb-5 flex items-center justify-center border border-[#EAEAEC] overflow-hidden relative">{product.imageUrl ? <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" /> : <span className="text-[#A1A1AA] text-sm font-medium tracking-wide">[Sin imagen]</span>}</div>
              <div className="mt-auto space-y-2"><div className="flex justify-between items-center text-sm bg-[#F9FAFA] p-3 rounded-[1rem] border border-[#EAEAEC]"><span className="text-[#71717A] font-medium text-xs">Costo base:</span><span className="font-medium text-[#111111]">${(product.cost || 0).toFixed(2)}</span></div><div className="flex justify-between items-center text-sm bg-white p-3 rounded-[1rem] border border-[#EAEAEC]"><span className="text-[#71717A] font-medium text-xs">Precio Venta:</span><span className="font-medium tracking-tight text-[#111111]">${(product.price || 0).toFixed(2)}</span></div></div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-[#EAEAEC] overflow-hidden w-full animate-in fade-in">
          <div className="overflow-x-auto w-full" style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr className="bg-white text-[#A1A1AA] text-[11px] font-bold uppercase tracking-widest border-b border-[#EAEAEC]">
                  <th className="px-4 md:px-6 py-4 md:py-5 w-20">Imagen</th>
                  <th className="px-4 md:px-6 py-4 md:py-5">Producto</th>
                  <th className="px-4 md:px-6 py-4 md:py-5">Stock</th>
                  <th className="px-4 md:px-6 py-4 md:py-5">Costo Base</th>
                  <th className="px-4 md:px-6 py-4 md:py-5">Precio Venta</th>
                  <th className="px-4 md:px-6 py-4 md:py-5 text-right">Acciones</th>
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
                    <td className="px-4 md:px-6 py-3 md:py-4 font-medium text-[#111111]">
                      <div className="flex items-center gap-2 flex-wrap">
                        {product.sku && <span className="font-bold text-[#4A6310] bg-[#E8F8B6]/50 px-2 py-1 rounded-[0.5rem] text-sm tracking-widest">#{product.sku}</span>}
                        <span className="text-base">{product.name}</span>
                      </div>
                    </td>
                    <td className="px-4 md:px-6 py-3 md:py-4">
                      <span className={`px-3 py-1 text-[10px] font-bold uppercase tracking-widest rounded-full flex-shrink-0 ${product.stock > 10 ? 'bg-[#E8F8B6]/50 text-[#4A6310]' : product.stock > 0 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'}`}>
                        {product.stock} en stock
                      </span>
                    </td>
                    <td className="px-4 md:px-6 py-3 md:py-4 font-medium text-[#71717A]">${(product.cost || 0).toFixed(2)}</td>
                    <td className="px-4 md:px-6 py-3 md:py-4 font-medium text-[#111111]">${(product.price || 0).toFixed(2)}</td>
                    <td className="px-4 md:px-6 py-3 md:py-4 text-right">
                      <div className="flex justify-end items-center gap-2">
                        {quickDeleteId === product.id ? (
                          <div className="flex items-center gap-1.5 bg-red-50 px-2 py-1 rounded-full mr-2">
                            <span className="text-[10px] font-bold text-red-500 uppercase tracking-widest ml-1">¿Borrar?</span>
                            <button onClick={(e) => { e.stopPropagation(); handleQuickDeleteProduct(product); }} className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold rounded-full transition-colors">SÍ</button>
                            <button onClick={(e) => { e.stopPropagation(); setQuickDeleteId(null); }} className="px-2.5 py-1 bg-white border border-[#EAEAEC] text-[#71717A] text-[10px] font-bold rounded-full transition-colors">NO</button>
                          </div>
                        ) : (
                          <button onClick={(e) => { e.stopPropagation(); setQuickDeleteId(product.id); }} className="p-2 text-[#A1A1AA] hover:text-red-500 bg-white border border-[#EAEAEC] hover:bg-red-50 hover:border-red-200 rounded-full transition-colors touch-manipulation">
                            <Trash2 size={14} strokeWidth={2.5} />
                          </button>
                        )}
                        <button className="text-[#71717A] hover:text-[#111111] font-medium text-xs px-4 py-2 bg-white border border-[#EAEAEC] hover:border-[#C8F169] rounded-[1rem] transition-colors touch-manipulation">Ver Detalles</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {detailProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm animate-in fade-in" onClick={() => { setDetailProduct(null); onRefresh(); }}>
          <div className="bg-white rounded-[2rem] shadow-[0_24px_60px_rgba(0,0,0,0.12)] border border-[#EAEAEC] w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 md:p-8 animate-in slide-in-from-bottom-4" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-6 gap-4">
              <div>
                <p className="text-[10px] text-[#71717A] font-bold uppercase tracking-widest mb-1">Detalle del Producto</p>
                <h3 className="text-xl font-medium text-[#111111] tracking-tight flex items-center gap-2 flex-wrap">
                  {detailProduct.sku && <span className="font-bold text-[#4A6310] bg-[#E8F8B6]/50 px-2 py-0.5 rounded-lg">#{detailProduct.sku}</span>}
                  <span>{detailProduct.name}</span>
                </h3>
              </div>
              <button onClick={() => { setDetailProduct(null); onRefresh(); }} className="p-2 rounded-[0.75rem] text-[#A1A1AA] hover:text-[#111111] hover:bg-[#EAEAEC] transition-colors touch-manipulation flex-shrink-0"><X size={18} /></button>
            </div>

            <form onSubmit={handleSaveName} className="mb-6 pb-6 border-b border-[#EAEAEC]/60">
              <label className="block text-sm font-medium text-[#71717A] mb-2">Nombre del Producto</label>
              <div className="flex gap-3">
                <input type="text" required value={editName} onChange={e => setEditName(e.target.value)} className="flex-1 px-4 py-3 bg-[#F9FAFA] border border-[#EAEAEC] rounded-[1.25rem] focus:ring-2 focus:ring-[#C8F169] focus:border-[#C8F169] transition-all outline-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] text-base" />
                <button type="submit" className="bg-[#1A1A1A] hover:bg-black text-white px-6 py-3 rounded-[1.25rem] transition-all font-medium shadow-md shadow-black/10 active:scale-95 touch-manipulation flex-shrink-0">Guardar</button>
              </div>
              <NameSuggester imagePreview={editImagePreview || detailProduct.imageUrl || null} currentName={editName} existingNames={products.filter(p => p.id !== detailProduct.id).map(p => p.name)} onSelect={(name) => setEditName(name)} />
              {editNameSuccess && <p className="mt-2 text-sm font-medium text-[#4A6310]">{editNameSuccess}</p>}
            </form>

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

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <div className="bg-[#F9FAFA] p-4 rounded-[1.25rem] border border-[#EAEAEC] text-center"><p className="text-[10px] text-[#71717A] font-bold uppercase tracking-widest mb-1">Unidades</p><p className="text-xl font-medium text-[#111111] tracking-tight">{totalUnits}</p></div>
              <div className="bg-[#F9FAFA] p-4 rounded-[1.25rem] border border-[#EAEAEC] text-center"><p className="text-[10px] text-[#71717A] font-bold uppercase tracking-widest mb-1">Ingresos</p><p className="text-xl font-medium text-[#111111] tracking-tight">${totalRevenue.toFixed(2)}</p></div>
              <div className="bg-[#F9FAFA] p-4 rounded-[1.25rem] border border-[#EAEAEC] text-center"><p className="text-[10px] text-[#71717A] font-bold uppercase tracking-widest mb-1">Ganancia</p><p className={`text-xl font-medium tracking-tight ${totalProfit >= 0 ? 'text-[#16A34A]' : 'text-red-500'}`}>${totalProfit.toFixed(2)}</p></div>
              <div className="bg-[#F9FAFA] p-4 rounded-[1.25rem] border border-[#EAEAEC] text-center"><p className="text-[10px] text-[#71717A] font-bold uppercase tracking-widest mb-1">Margen</p><p className={`text-xl font-medium tracking-tight ${avgMargin >= 20 ? 'text-[#16A34A]' : avgMargin > 0 ? 'text-amber-600' : 'text-red-500'}`}>{avgMargin.toFixed(1)}%</p></div>
            </div>

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

            <div className="mt-6 pt-6 border-t border-red-100">
              {!confirmDelete ? (
                <button type="button" onClick={() => setConfirmDelete(true)} className="flex items-center gap-2 text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-100 px-5 py-3 rounded-[1.25rem] text-sm font-medium transition-colors touch-manipulation"><Trash2 size={15} /><span>Eliminar producto completo</span></button>
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

      {lightboxUrl && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in" onClick={() => setLightboxUrl(null)}>
          <button className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors touch-manipulation"><X size={22} /></button>
          <img src={lightboxUrl} alt="Imagen ampliada" className="max-w-[92vw] max-h-[88vh] rounded-[1.5rem] shadow-2xl object-contain animate-in zoom-in-90" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}