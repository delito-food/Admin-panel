import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Zap, Loader2, Plus, Trash2, CheckCircle2 } from 'lucide-react';
import type { VendorCategory } from '@/types';

interface QuickAddProps {
    vendorId: string;
    categories: VendorCategory[];
    onClose: () => void;
}

interface QuickAddRow {
    _id: string;
    name: string;
    price: string;
    categoryId: string;
    isVeg: boolean;
    prepTime: string;
}

export default function QuickAdd({ vendorId, categories, onClose }: QuickAddProps) {
    const [localCategories, setLocalCategories] = useState(categories);

    const createEmptyRow = (): QuickAddRow => ({
        _id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        name: '',
        price: '',
        categoryId: localCategories.length > 0 ? localCategories[0].categoryId : '',
        isVeg: true,
        prepTime: '15'
    });

    const [rows, setRows] = useState<QuickAddRow[]>([createEmptyRow(), createEmptyRow(), createEmptyRow()]);
    const [saving, setSaving] = useState(false);

    const updateRow = (id: string, field: keyof QuickAddRow, value: any) => {
        setRows(rows.map(r => r._id === id ? { ...r, [field]: value } : r));
    };

    const addRow = () => {
        setRows([...rows, createEmptyRow()]);
    };

    const removeRow = (id: string) => {
        if (rows.length === 1) return;
        setRows(rows.filter(r => r._id !== id));
    };

    const handleAddCategory = async (rowId: string) => {
        const name = window.prompt("Enter new category name:");
        if (!name || name.trim() === '') return;
        
        try {
            const res = await fetch(`/api/menu-management/vendor/${vendorId}/categories`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name.trim(), sortOrder: localCategories.length, isActive: true })
            });
            const data = await res.json();
            if (data.success) {
                const newCat = { categoryId: data.data?.categoryId || data.data?.id || Math.random().toString(), name: name.trim() } as VendorCategory;
                setLocalCategories([...localCategories, newCat]);
                updateRow(rowId, 'categoryId', newCat.categoryId);
                alert("Category created successfully!");
            } else {
                alert("Failed to create: " + data.error);
            }
        } catch (e) {
            alert("Error creating category");
        }
    };

    // A row is valid if it has a name and a positive price
    const isValidRow = (r: QuickAddRow) => r.name.trim() !== '' && r.price !== '' && !isNaN(Number(r.price)) && Number(r.price) >= 0;
    // A row is empty if all text fields are untouched
    const isEmptyRow = (r: QuickAddRow) => r.name.trim() === '' && r.price === '';

    const validRowsToSave = rows.filter(r => isValidRow(r));
    const hasInvalidNonEmptyRows = rows.some(r => !isValidRow(r) && !isEmptyRow(r));

    const handleSaveAll = async () => {
        if (validRowsToSave.length === 0) return;

        setSaving(true);
        try {
            const items = validRowsToSave.map(row => {
                const category = localCategories.find(c => c.categoryId === row.categoryId);
                return {
                    name: row.name,
                    price: Number(row.price),
                    categoryName: category?.name || '',
                    isVeg: row.isVeg,
                    preparationTime: Number(row.prepTime) || 15,
                    discount: 0,
                    imageUrl: '', // Intentional blank, vendor must add later
                    isAvailable: true,
                    isBestSeller: false
                };
            });

            const res = await fetch(`/api/menu-management/vendor/${vendorId}/items/bulk`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items })
            });

            const data = await res.json();
            if (data.success) {
                alert(`Successfully created ${data.created} items! Note: Please edit these items later to add images.`);
                onClose();
            } else {
                alert(`Failed to save items: ${data.error || 'Check validation errors'}`);
            }
        } catch (error) {
            console.error('Quick add error:', error);
            alert('Failed to save items.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[110] bg-[var(--background)] flex flex-col overflow-hidden">
            <div className="px-8 py-6 border-b border-[var(--border)] flex justify-between items-center bg-[var(--surface)]">
                <div>
                    <h2 className="text-xl font-bold text-[var(--foreground)] tracking-tight flex items-center gap-2">
                        <Zap className="text-[var(--primary)]" />
                        Quick Add Items
                    </h2>
                    <p className="text-sm font-medium text-[var(--foreground-secondary)] mt-1">Spreadsheet-style entry for fast menu building.</p>
                </div>
                <div className="flex items-center gap-4">
                    <button onClick={onClose} className="btn btn-outline px-4 py-2 text-sm font-bold rounded-lg border border-[var(--border)] hover:bg-[var(--surface-hover)]">
                        Cancel
                    </button>
                    <button 
                        onClick={handleSaveAll}
                        disabled={validRowsToSave.length === 0 || hasInvalidNonEmptyRows || saving}
                        className="btn px-6 py-2 text-sm font-bold rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                        {saving ? 'Saving...' : `Save ${validRowsToSave.length} Items`}
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 lg:p-8 custom-scrollbar">
                
                {hasInvalidNonEmptyRows && (
                    <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-500 text-sm font-medium">
                        Please fix the highlighted rows before saving. Make sure Name and Price are filled correctly.
                    </div>
                )}

                <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--background)] shadow-sm">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[900px]">
                            <thead>
                                <tr className="bg-[var(--surface)] border-b border-[var(--border)] text-[var(--foreground-secondary)] text-xs font-bold uppercase tracking-wider">
                                    <th className="p-4 w-12 text-center">#</th>
                                    <th className="p-4 w-1/4">Name *</th>
                                    <th className="p-4 w-32">Price (₹) *</th>
                                    <th className="p-4 w-1/4">Category *</th>
                                    <th className="p-4 w-24 text-center">Veg</th>
                                    <th className="p-4 w-28">Prep (Min)</th>
                                    <th className="p-4 w-16"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--border)]">
                                {rows.map((row, index) => {
                                    const isInvalid = !isEmptyRow(row) && !isValidRow(row);
                                    return (
                                        <tr key={row._id} className={`transition-colors ${isInvalid ? 'bg-red-500/5' : 'hover:bg-[var(--surface-hover)]'}`}>
                                            <td className="p-4 text-center text-xs font-bold text-[var(--foreground-secondary)]">{index + 1}</td>
                                            <td className="p-3">
                                                <input 
                                                    type="text" 
                                                    placeholder="Item name"
                                                    className={`w-full bg-transparent border rounded px-3 py-2 text-sm font-medium focus:outline-none focus:border-[var(--primary)] ${isInvalid && !row.name ? 'border-red-400 placeholder-red-300' : 'border-[var(--border)]'}`}
                                                    value={row.name}
                                                    onChange={e => updateRow(row._id, 'name', e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' && index === rows.length - 1) addRow();
                                                    }}
                                                />
                                            </td>
                                            <td className="p-3">
                                                <input 
                                                    type="number" 
                                                    placeholder="0"
                                                    min="0"
                                                    className={`w-full bg-transparent border rounded px-3 py-2 text-sm font-medium focus:outline-none focus:border-[var(--primary)] ${isInvalid && (!row.price || isNaN(Number(row.price))) ? 'border-red-400 placeholder-red-300' : 'border-[var(--border)]'}`}
                                                    value={row.price}
                                                    onChange={e => updateRow(row._id, 'price', e.target.value)}
                                                />
                                            </td>
                                            <td className="p-3">
                                                <select
                                                    className="w-full bg-transparent border border-[var(--border)] rounded px-3 py-2 text-sm font-medium focus:outline-none focus:border-[var(--primary)]"
                                                    value={row.categoryId}
                                                    onChange={e => {
                                                        if (e.target.value === 'ADD_NEW') {
                                                            handleAddCategory(row._id);
                                                        } else {
                                                            updateRow(row._id, 'categoryId', e.target.value);
                                                        }
                                                    }}
                                                >
                                                    {localCategories.map(c => (
                                                        <option key={c.categoryId} value={c.categoryId} className="bg-[var(--surface)] text-[var(--foreground)]">{c.name}</option>
                                                    ))}
                                                    <option value="ADD_NEW" className="bg-[var(--surface)] text-blue-500 font-bold">+ Add Category</option>
                                                    {localCategories.length === 0 && <option value="" className="bg-[var(--surface)] text-[var(--foreground)]">No categories</option>}
                                                </select>
                                            </td>
                                            <td className="p-3 text-center">
                                                <input 
                                                    type="checkbox" 
                                                    className="w-4 h-4 accent-[var(--primary)] rounded cursor-pointer"
                                                    checked={row.isVeg}
                                                    onChange={e => updateRow(row._id, 'isVeg', e.target.checked)}
                                                />
                                            </td>
                                            <td className="p-3">
                                                <input 
                                                    type="number" 
                                                    placeholder="15"
                                                    className="w-full bg-transparent border border-[var(--border)] rounded px-3 py-2 text-sm font-medium focus:outline-none focus:border-[var(--primary)]"
                                                    value={row.prepTime}
                                                    onChange={e => updateRow(row._id, 'prepTime', e.target.value)}
                                                />
                                            </td>
                                            <td className="p-3 text-right">
                                                <button 
                                                    onClick={() => removeRow(row._id)} 
                                                    disabled={rows.length === 1}
                                                    className="p-2 text-[var(--foreground-secondary)] hover:text-red-500 hover:bg-red-500/10 rounded transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    
                    <div className="p-2 bg-[var(--surface)] border-t border-[var(--border)]">
                        <button 
                            onClick={addRow}
                            className="w-full py-3 flex items-center justify-center gap-2 text-sm font-bold text-[var(--foreground-secondary)] hover:text-[var(--foreground)] hover:bg-[var(--surface-hover)] rounded-lg transition-colors border border-dashed border-transparent hover:border-[var(--border)]"
                        >
                            <Plus size={18} /> Add another row
                        </button>
                    </div>
                </div>
                
                <div className="mt-4 text-xs font-medium text-[var(--foreground-secondary)] flex items-center justify-center gap-6">
                    <span className="flex items-center gap-1">Tip: Press <kbd className="px-1.5 py-0.5 bg-[var(--surface-hover)] border border-[var(--border)] rounded font-mono">Tab</kbd> to move between fields</span>
                    <span className="flex items-center gap-1">Press <kbd className="px-1.5 py-0.5 bg-[var(--surface-hover)] border border-[var(--border)] rounded font-mono">Enter</kbd> on the last name field to add a row</span>
                </div>
            </div>
        </motion.div>
    );
}
