import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, UploadCloud, ImageIcon, Loader2, AlertCircle, CheckCircle2, Trash2 } from 'lucide-react';
import type { AdminMenuItem } from '@/types';

interface BulkImageUploadProps {
    vendorId: string;
    items: AdminMenuItem[];
    onClose: () => void;
}

interface ImageRow {
    id: string;
    file: File;
    filename: string;
    basename: string; // without extension
    previewUrl: string;
    matchedItemId: string | null;
    matchedItemName: string | null;
    status: 'pending' | 'uploading' | 'success' | 'error';
    error?: string;
}

export default function BulkImageUpload({ vendorId, items, onClose }: BulkImageUploadProps) {
    const [rows, setRows] = useState<ImageRow[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [processing, setProcessing] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Cleanup object URLs on unmount
    useEffect(() => {
        return () => {
            rows.forEach(r => URL.revokeObjectURL(r.previewUrl));
        };
    }, []);

    const normalizeString = (str: string) => {
        return str.toLowerCase().replace(/[^a-z0-9]/g, '');
    };

    const handleFiles = (files: FileList | File[]) => {
        const newRows: ImageRow[] = [];
        
        Array.from(files).forEach(file => {
            if (!file.type.startsWith('image/')) return;
            
            const filename = file.name;
            const basename = filename.substring(0, filename.lastIndexOf('.')) || filename;
            const normalizedBase = normalizeString(basename);
            
            // Try to find a matching item
            let matchedItem = items.find(item => normalizeString(item.name) === normalizedBase);
            
            // If strict match fails, try a slightly looser one (e.g. spaces vs hyphens)
            if (!matchedItem) {
                 matchedItem = items.find(item => 
                     item.name.toLowerCase().replace(/[-\s]/g, '') === basename.toLowerCase().replace(/[-\s]/g, '')
                 );
            }

            newRows.push({
                id: Math.random().toString(36).substr(2, 9),
                file,
                filename,
                basename,
                previewUrl: URL.createObjectURL(file),
                matchedItemId: matchedItem ? matchedItem.itemId! : null,
                matchedItemName: matchedItem ? matchedItem.name : null,
                status: 'pending'
            });
        });

        setRows(prev => [...prev, ...newRows]);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files?.length) {
            handleFiles(e.dataTransfer.files);
        }
    };

    const removeRow = (id: string) => {
        setRows(prev => {
            const filtered = prev.filter(r => r.id !== id);
            const removed = prev.find(r => r.id === id);
            if (removed) URL.revokeObjectURL(removed.previewUrl);
            return filtered;
        });
    };

    const uploadToCloudinary = async (file: File): Promise<string> => {
        const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || 'dnmuwv56l';
        const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET || 'platoos_preset';
        
        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', uploadPreset);
        formData.append('folder', `menu_images/${vendorId}`);

        const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            throw new Error('Upload failed');
        }

        const data = await response.json();
        return data.secure_url;
    };

    const handleUploadAndSave = async () => {
        const validRows = rows.filter(r => r.matchedItemId && r.status === 'pending');
        if (validRows.length === 0) return;

        setProcessing(true);
        const updates: { itemId: string, imageUrl: string }[] = [];

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (!row.matchedItemId || row.status !== 'pending') continue;

            try {
                // Update UI state to uploading
                setRows(prev => prev.map(r => r.id === row.id ? { ...r, status: 'uploading' } : r));
                
                const imageUrl = await uploadToCloudinary(row.file);
                updates.push({ itemId: row.matchedItemId, imageUrl });

                // Update UI state to success
                setRows(prev => prev.map(r => r.id === row.id ? { ...r, status: 'success' } : r));
            } catch (error: any) {
                setRows(prev => prev.map(r => r.id === row.id ? { ...r, status: 'error', error: error.message } : r));
            }
        }

        if (updates.length > 0) {
            try {
                const res = await fetch(`/api/menu-management/vendor/${vendorId}/items/bulk-images`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ items: updates })
                });

                const result = await res.json();
                if (result.success) {
                    // Briefly wait to show success states
                    setTimeout(() => {
                        onClose();
                    }, 1000);
                } else {
                    alert('Failed to save some image URLs to database.');
                    setProcessing(false);
                }
            } catch (error) {
                console.error(error);
                alert('API error while saving image mapping.');
                setProcessing(false);
            }
        } else {
            setProcessing(false);
        }
    };

    const mappedCount = rows.filter(r => r.matchedItemId).length;

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[110] bg-[var(--background)] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="px-8 py-6 border-b border-[var(--border)] flex justify-between items-center bg-[var(--surface)] shrink-0">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                        <ImageIcon size={24} />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-[var(--foreground)] tracking-tight">Bulk Image Match</h2>
                        <p className="text-sm font-medium text-[var(--foreground-secondary)] mt-1">
                            Upload images named after your menu items (e.g. <code className="bg-[var(--surface-hover)] px-1 rounded">burger.jpg</code>).
                        </p>
                    </div>
                </div>
                <button onClick={onClose} disabled={processing} className="p-2 hover:bg-[var(--surface-hover)] rounded-md transition-colors disabled:opacity-50"><X size={24} /></button>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                {rows.length === 0 ? (
                    <div className="max-w-3xl mx-auto flex flex-col items-center justify-center min-h-[70vh] gap-8">
                        <div 
                            className={`w-full p-12 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center gap-4 transition-colors cursor-pointer
                                ${isDragging ? 'border-[var(--primary)] bg-[var(--primary)]/5' : 'border-[var(--border)] hover:bg-[var(--surface-hover)]'}`}
                            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                            onDragLeave={() => setIsDragging(false)}
                            onDrop={handleDrop}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <input type="file" ref={fileInputRef} className="hidden" accept="image/*" multiple onChange={(e) => e.target.files && handleFiles(e.target.files)} />
                            <div className="w-20 h-20 rounded-full bg-[var(--surface)] shadow-sm flex items-center justify-center text-[var(--primary)]">
                                <UploadCloud size={40} />
                            </div>
                            <div className="text-center">
                                <h3 className="text-lg font-bold text-[var(--foreground)]">Drag & drop multiple images</h3>
                                <p className="text-sm font-medium text-[var(--foreground-secondary)] mt-2">or click to browse from your computer</p>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="max-w-5xl mx-auto">
                        <div className="flex justify-between items-end mb-6">
                            <div>
                                <h3 className="text-lg font-bold text-[var(--foreground)]">Image Mapping Preview</h3>
                                <p className="text-sm font-medium text-[var(--foreground-secondary)] mt-1">
                                    {mappedCount} of {rows.length} images mapped successfully.
                                </p>
                            </div>
                            <button onClick={() => fileInputRef.current?.click()} disabled={processing} className="btn btn-outline px-4 py-2 text-sm">
                                + Add More Images
                            </button>
                            <input type="file" ref={fileInputRef} className="hidden" accept="image/*" multiple onChange={(e) => e.target.files && handleFiles(e.target.files)} />
                        </div>

                        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden shadow-sm">
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-[var(--surface-hover)] border-b border-[var(--border)] text-xs uppercase tracking-wider text-[var(--foreground-secondary)]">
                                    <tr>
                                        <th className="p-4 w-16 text-center">Preview</th>
                                        <th className="p-4 w-1/3">Filename</th>
                                        <th className="p-4 w-1/3">Matched Item</th>
                                        <th className="p-4 w-24 text-center">Status</th>
                                        <th className="p-4 w-16"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[var(--border)]">
                                    {rows.map((row) => (
                                        <tr key={row.id} className={!row.matchedItemId ? 'bg-red-500/5' : ''}>
                                            <td className="p-3 text-center">
                                                <div className="w-12 h-12 rounded border border-[var(--border)] overflow-hidden bg-[var(--surface-hover)] mx-auto relative group">
                                                    <img src={row.previewUrl} alt="preview" className="w-full h-full object-cover" />
                                                </div>
                                            </td>
                                            <td className="p-4 font-medium text-sm text-[var(--foreground)] truncate">
                                                {row.filename}
                                            </td>
                                            <td className="p-4 font-medium text-sm">
                                                {row.matchedItemId ? (
                                                    <span className="text-[var(--foreground)] font-bold">{row.matchedItemName}</span>
                                                ) : (
                                                    <span className="text-red-500 italic text-xs">No matching item found</span>
                                                )}
                                            </td>
                                            <td className="p-4 text-center">
                                                {row.status === 'success' && <CheckCircle2 size={18} className="text-green-500 mx-auto" />}
                                                {row.status === 'uploading' && <Loader2 size={18} className="text-blue-500 mx-auto animate-spin" />}
                                                {row.status === 'error' && (
                                                    <div className="group/err relative flex justify-center cursor-help">
                                                        <AlertCircle size={18} className="text-red-500" />
                                                        <div className="absolute bottom-full mb-2 bg-red-600 text-white text-xs px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover/err:opacity-100 z-10 pointer-events-none">{row.error}</div>
                                                    </div>
                                                )}
                                                {row.status === 'pending' && row.matchedItemId && <span className="text-xs text-[var(--foreground-secondary)]">Ready</span>}
                                                {row.status === 'pending' && !row.matchedItemId && <span className="text-xs text-red-500">Skip</span>}
                                            </td>
                                            <td className="p-4 text-right">
                                                <button onClick={() => removeRow(row.id)} disabled={processing} className="p-1.5 text-red-500 hover:bg-red-500/10 rounded transition-colors disabled:opacity-50"><Trash2 size={16} /></button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>

            {/* Footer */}
            {rows.length > 0 && (
                <div className="px-8 py-5 border-t border-[var(--border)] bg-[var(--surface)] flex justify-between items-center shrink-0">
                    <div className="text-sm font-medium text-[var(--foreground-secondary)]">
                        {mappedCount} images will be uploaded and mapped.
                    </div>
                    <div className="flex gap-4">
                        <button onClick={onClose} disabled={processing} className="btn btn-outline px-6 py-2.5">Cancel</button>
                        <button 
                            onClick={handleUploadAndSave} 
                            disabled={processing || mappedCount === 0} 
                            className="btn btn-primary px-8 py-2.5 min-w-[160px]"
                        >
                            {processing ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : `Upload & Save (${mappedCount})`}
                        </button>
                    </div>
                </div>
            )}
        </motion.div>
    );
}
