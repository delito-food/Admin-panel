import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { X, UploadCloud, FileSpreadsheet, Loader2, AlertCircle, CheckCircle2, Trash2 } from 'lucide-react';
import Papa from 'papaparse';
import type { VendorCategory } from '@/types';

interface CsvImportProps {
    vendorId: string;
    categories: VendorCategory[];
    onClose: () => void;
}

interface ParsedRow {
    _id: string; // Unique ID for React map
    name: string;
    description: string;
    price: string | number;
    category: string;
    isVeg: string;
    prepTime: string | number;
    _error?: string;
    _valid: boolean;
}

export default function CsvImport({ vendorId, categories, onClose }: CsvImportProps) {
    const [rows, setRows] = useState<ParsedRow[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [importing, setImporting] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const categoriesMap = new Map(categories.map(c => [c.name.toLowerCase().trim(), c.categoryId]));

    const validateRow = (row: any): ParsedRow => {
        const parsed: ParsedRow = {
            _id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            name: row.name || '',
            description: row.description || '',
            price: row.price || '',
            category: row.category || '',
            isVeg: row.isVeg || '',
            prepTime: row.prepTime || '',
            _valid: true
        };

        if (!parsed.name) {
            parsed._error = 'Name is required';
            parsed._valid = false;
        } else if (!parsed.price || isNaN(Number(parsed.price)) || Number(parsed.price) < 0) {
            parsed._error = 'Price must be a valid positive number';
            parsed._valid = false;
        } else if (!parsed.category) {
            parsed._error = 'Category is required';
            parsed._valid = false;
        }

        return parsed;
    };

    const handleFileUpload = (file: File) => {
        if (!file.name.endsWith('.csv')) {
            alert('Please upload a valid CSV file');
            return;
        }

        setProcessing(true);
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                const parsedRows = results.data.map((row: any) => validateRow(row));
                setRows(parsedRows);
                setProcessing(false);
            },
            error: (error) => {
                alert(`Error parsing CSV: ${error.message}`);
                setProcessing(false);
            }
        });
    };

    const handleImport = async () => {
        const validRows = rows.filter(r => r._valid);
        if (validRows.length === 0) return;

        setImporting(true);
        try {
            const items = validRows.map(row => ({
                name: row.name,
                description: row.description,
                price: Number(row.price),
                categoryName: row.category,
                isVeg: row.isVeg.toLowerCase() === 'yes' || row.isVeg.toLowerCase() === 'true' || row.isVeg.toLowerCase() === 'veg',
                preparationTime: row.prepTime ? Number(row.prepTime) : 15,
                discount: 0,
                imageUrl: '',
                isAvailable: true,
                isBestSeller: false
            }));

            const res = await fetch(`/api/menu-management/vendor/${vendorId}/items/bulk`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items })
            });

            const data = await res.json();
            if (data.success) {
                alert(`Successfully imported ${data.created} items!`);
                onClose();
            } else {
                if (data.errors) {
                    alert(`Import failed with errors:\n${data.errors.map((e: any) => `Row ${e.row}: ${e.error}`).join('\n')}`);
                } else {
                    alert(`Import failed: ${data.error}`);
                }
            }
        } catch (error) {
            console.error('Import error:', error);
            alert('Failed to import items');
        } finally {
            setImporting(false);
        }
    };

    const downloadTemplate = () => {
        const headers = ['name', 'description', 'price', 'category', 'isVeg', 'prepTime'];
        const sample1 = ['Margherita Pizza', 'Classic cheese and tomato', '299', categories[0]?.name || 'Pizzas', 'yes', '20'];
        const sample2 = ['Chicken Burger', 'Crispy fried chicken', '199', categories[1]?.name || 'Burgers', 'no', '15'];
        
        const csv = Papa.unparse([headers, sample1, sample2]);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.setAttribute('download', 'menu_import_template.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const removeRow = (id: string) => {
        setRows(rows.filter(r => r._id !== id));
    };

    const validCount = rows.filter(r => r._valid).length;

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[110] bg-[var(--background)] flex flex-col overflow-hidden">
            <div className="px-8 py-6 border-b border-[var(--border)] flex justify-between items-center bg-[var(--surface)]">
                <div>
                    <h2 className="text-xl font-bold text-[var(--foreground)] tracking-tight flex items-center gap-2">
                        <FileSpreadsheet className="text-[var(--primary)]" />
                        Bulk Import via CSV
                    </h2>
                    <p className="text-sm font-medium text-[var(--foreground-secondary)] mt-1">Upload multiple menu items instantly using a spreadsheet.</p>
                </div>
                <button onClick={onClose} className="p-2 hover:bg-[var(--surface-hover)] rounded-md transition-colors"><X size={24} /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                {rows.length === 0 ? (
                    <div className="max-w-3xl mx-auto flex flex-col items-center justify-center min-h-[70vh] gap-8">
                        <div 
                            className={`w-full p-12 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center gap-4 transition-colors cursor-pointer
                                ${isDragging ? 'border-[var(--primary)] bg-[var(--primary)]/5' : 'border-[var(--border)] hover:bg-[var(--surface-hover)]'}`}
                            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                            onDragLeave={() => setIsDragging(false)}
                            onDrop={(e) => {
                                e.preventDefault();
                                setIsDragging(false);
                                if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                                    handleFileUpload(e.dataTransfer.files[0]);
                                }
                            }}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <input type="file" ref={fileInputRef} className="hidden" accept=".csv" onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])} />
                            
                            <div className="w-20 h-20 bg-[var(--surface)] rounded-full flex items-center justify-center mb-2 shadow-sm border border-[var(--border)]">
                                {processing ? <Loader2 size={32} className="text-[var(--primary)] animate-spin" /> : <UploadCloud size={32} className="text-[var(--foreground-secondary)]" />}
                            </div>
                            <h3 className="text-xl font-bold text-[var(--foreground)]">Drag & drop your CSV file here</h3>
                            <p className="text-[var(--foreground-secondary)] font-medium">or click to browse from your computer</p>
                        </div>
                        
                        <div className="flex items-center gap-4">
                            <span className="text-[var(--foreground-secondary)] font-medium">Need a starting point?</span>
                            <button onClick={downloadTemplate} className="btn btn-outline px-4 py-2 text-sm font-bold rounded-lg border border-[var(--border)] hover:bg-[var(--surface-hover)]">
                                Download Template
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-6">
                        <div className="flex items-center justify-between bg-[var(--surface)] p-4 rounded-lg border border-[var(--border)]">
                            <div>
                                <h3 className="font-bold text-[var(--foreground)] text-lg">Preview Import</h3>
                                <p className="text-sm font-medium text-[var(--foreground-secondary)] mt-1">
                                    {validCount} valid items out of {rows.length} total rows
                                </p>
                            </div>
                            <div className="flex gap-3">
                                <button onClick={() => setRows([])} className="btn px-4 py-2 text-sm font-bold rounded-lg border border-[var(--border)] hover:bg-[var(--surface-hover)]">
                                    Cancel & Restart
                                </button>
                                <button 
                                    onClick={handleImport}
                                    disabled={validCount === 0 || importing}
                                    className="btn px-6 py-2 text-sm font-bold rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                >
                                    {importing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                                    {importing ? 'Importing...' : `Import ${validCount} Items`}
                                </button>
                            </div>
                        </div>

                        <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--background)]">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse min-w-[800px]">
                                    <thead>
                                        <tr className="bg-[var(--surface)] border-b border-[var(--border)] text-[var(--foreground-secondary)] text-xs font-bold uppercase tracking-wider">
                                            <th className="p-4 w-12 text-center">St</th>
                                            <th className="p-4">Name</th>
                                            <th className="p-4 w-24">Price</th>
                                            <th className="p-4 w-40">Category</th>
                                            <th className="p-4 w-24">Veg</th>
                                            <th className="p-4 w-16"></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[var(--border)]">
                                        {rows.map((row) => (
                                            <tr key={row._id} className={`${!row._valid ? 'bg-red-500/5' : ''}`}>
                                                <td className="p-4 text-center">
                                                    {row._valid ? (
                                                        <CheckCircle2 size={18} className="text-green-500 mx-auto" />
                                                    ) : (
                                                        <div className="group relative flex justify-center">
                                                            <AlertCircle size={18} className="text-red-500" />
                                                            <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 bg-red-600 text-white text-xs px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10 font-medium">
                                                                {row._error}
                                                            </div>
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="p-4 font-medium text-sm text-[var(--foreground)]">{row.name || <span className="text-red-400 italic">Missing</span>}</td>
                                                <td className="p-4 font-medium text-sm text-[var(--foreground)]">₹{row.price}</td>
                                                <td className="p-4 font-medium text-sm text-[var(--foreground)]">
                                                    {row.category}
                                                    {row.category && !categoriesMap.has(row.category.toLowerCase().trim()) && (
                                                        <span className="ml-2 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded border border-blue-200" title="This category will be created automatically">New</span>
                                                    )}
                                                </td>
                                                <td className="p-4 font-medium text-sm text-[var(--foreground)]">
                                                    {row.isVeg?.toLowerCase() === 'yes' || row.isVeg?.toLowerCase() === 'true' || row.isVeg?.toLowerCase() === 'veg' ? '🟢' : '🔴'}
                                                </td>
                                                <td className="p-4 text-right">
                                                    <button onClick={() => removeRow(row._id)} className="p-1.5 text-red-500 hover:bg-red-500/10 rounded transition-colors"><Trash2 size={16} /></button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </motion.div>
    );
}
