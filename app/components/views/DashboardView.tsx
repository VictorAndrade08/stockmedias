"use client";

import React, { useState, useMemo } from 'react';
import { DollarSign, TrendingUp, PackageMinus, Pencil, Trash2, X } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { DashboardStats, Sale, Product } from '../../../types';

export function DashboardView({ stats, sales, products, onRefresh }: { stats: DashboardStats; sales: Sale[]; products: Product[]; onRefresh: () => void }) {
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