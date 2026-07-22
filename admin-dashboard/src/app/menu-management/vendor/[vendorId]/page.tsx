'use client';

import { useState, useEffect, useCallback, useMemo, use } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Search, Filter, Plus, Edit3, Trash2, CheckCircle, XCircle, Clock,
    Store, X, ImageIcon, Loader2, ArrowLeft, Image as ImageIcon2, UtensilsCrossed, Tag, DollarSign, Layers, Package, FileSpreadsheet, Zap
} from 'lucide-react';
import CsvImport from './CsvImport';
import QuickAdd from './QuickAdd';
import BulkImageUpload from './BulkImageUpload';
import { useRouter } from 'next/navigation';
import { storage } from '@/lib/firebase';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import type { AdminMenuItem, VendorCategory } from '@/types';

const AVAILABLE_TAGS = [
    "thali", "combo", "meal bowl", "mini meal",
    "vegan", "gluten-free", "healthy", "keto", "jain", "high-protein",
    "spicy", "sweet", "crispy", "grilled", "roasted", "fried", "baked",
    "north indian", "south indian", "chinese", "italian", "continental", "mexican", "street food", "mughlai", "bengali", "maharashtrian", "gujarati", "punjabi", "rajasthani", "kerala", "goan", "american", "lebanese", "thai", "japanese",
    "breakfast", "lunch", "dinner", "snacks", "midnight cravings",
    "biryani", "pizza", "burger", "sandwich", "roll", "wrap", "dosa", "idli", "paratha", "roti", "naan", "curry", "dal", "paneer", "chicken", "mutton", "fish", "prawns", "egg", "noodles", "pasta", "momos", "chaat", "soup", "salad", "dessert", "ice cream", "cake", "pastry", "beverage", "shake", "juice", "coffee", "tea",
    "party", "festival special", "fasting", "vrat"
];

export default function VendorMenuManagement({ params }: { params: Promise<{ vendorId: string }> }) {
    const { vendorId } = use(params);
    const router = useRouter();

    const [items, setItems] = useState<AdminMenuItem[]>([]);
    const [categories, setCategories] = useState<VendorCategory[]>([]);
    const [vendor, setVendor] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'items' | 'categories'>('items');
    
    // UI state
    const [searchQuery, setSearchQuery] = useState('');
    
    // Modal states
    const [itemModal, setItemModal] = useState<{ open: boolean; item: AdminMenuItem | null }>({ open: false, item: null });
    const [categoryModal, setCategoryModal] = useState<{ open: boolean; category: VendorCategory | null }>({ open: false, category: null });
    const [deleteModal, setDeleteModal] = useState<{ open: boolean; type: 'item' | 'category'; id: string | null }>({ open: false, type: 'item', id: null });
    const [showCsvImport, setShowCsvImport] = useState(false);
    const [showQuickAdd, setShowQuickAdd] = useState(false);
    const [showBulkImage, setShowBulkImage] = useState(false);
    
    const [processing, setProcessing] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [toastMsg, setToastMsg] = useState('');

    const showToast = (msg: string) => {
        setToastMsg(msg);
        setTimeout(() => setToastMsg(''), 3000);
    };
    
    const [newTagInput, setNewTagInput] = useState('');
    
    // Form States
    const [itemForm, setItemForm] = useState<Partial<AdminMenuItem>>({});
    const [categoryForm, setCategoryForm] = useState<Partial<VendorCategory>>({});

    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            
            // Fetch vendor details
            try {
                const vRes = await fetch(`/api/vendors`);
                if (vRes.ok) {
                    const vData = await vRes.json();
                    if (vData.success) {
                        const foundVendor = vData.data.find((v: any) => v.vendorId === vendorId);
                        if (foundVendor) setVendor(foundVendor);
                    }
                }
            } catch (e) {
                console.log('Could not fetch vendor info directly');
            }

            const [itemsRes, catRes] = await Promise.all([
                fetch(`/api/menu-management/vendor/${vendorId}/items`),
                fetch(`/api/menu-management/vendor/${vendorId}/categories`)
            ]);
            
            const itemsData = await itemsRes.json();
            const catData = await catRes.json();
            
            if (itemsData.success) setItems(itemsData.data);
            if (catData.success) setCategories(catData.data);
            
        } catch (error) {
            console.error('Fetch error:', error);
            alert('Failed to load data');
        } finally {
            setLoading(false);
        }
    }, [vendorId]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Stop background scroll when modals are open
    useEffect(() => {
        if (itemModal.open || categoryModal.open || deleteModal.open || showCsvImport || showQuickAdd || showBulkImage) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => { document.body.style.overflow = 'unset'; };
    }, [itemModal.open, categoryModal.open, deleteModal.open, showCsvImport, showQuickAdd, showBulkImage]);

    const handleImageUpload = async (file: File) => {
        setUploading(true);
        try {
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
                const errorData = await response.json();
                console.error('Cloudinary upload error:', errorData);
                throw new Error(errorData.error?.message || 'Upload failed');
            }

            const data = await response.json();
            // Return the HTTPS URL of the uploaded image
            return data.secure_url;
            
        } catch (error) {
            console.error('Error uploading image to Cloudinary:', error);
            alert('Failed to upload image. Please try again.');
            return null;
        } finally {
            setUploading(false);
        }
    };

    const handleSaveItem = async () => {
        setProcessing(true);
        try {
            // Validate required fields
            if (!itemForm.name || !itemForm.price || !itemForm.categoryId) {
                alert('Please fill Name, Price, and Category');
                setProcessing(false);
                return;
            }
            if (!itemForm.imageUrl) {
                alert('Image is mandatory for all menu items');
                setProcessing(false);
                return;
            }

            // Find category name
            const category = categories.find(c => c.categoryId === itemForm.categoryId);
            const payload = {
                ...itemForm,
                categoryName: category?.name || '',
                price: Number(itemForm.price),
                discount: Number(itemForm.discount || 0),
                preparationTime: Number(itemForm.preparationTime || 15),
            };

            const method = payload.itemId ? 'PATCH' : 'POST';
            
            const res = await fetch(`/api/menu-management/vendor/${vendorId}/items`, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            
            const result = await res.json();
            if (result.success) {
                setItemModal({ open: false, item: null });
                fetchData();
            } else {
                alert(result.error || 'Failed to save item');
            }
        } catch (error) {
            console.error(error);
            alert('Error saving item');
        } finally {
            setProcessing(false);
        }
    };

    const handleDelete = async () => {
        if (!deleteModal.id) return;
        setProcessing(true);
        try {
            const endpoint = deleteModal.type === 'item' 
                ? `/api/menu-management/vendor/${vendorId}/items?itemId=${deleteModal.id}`
                : `/api/menu-management/vendor/${vendorId}/categories?categoryId=${deleteModal.id}`;
                
            const res = await fetch(endpoint, { method: 'DELETE' });
            const result = await res.json();
            
            if (result.success) {
                setDeleteModal({ open: false, type: 'item', id: null });
                fetchData();
            } else {
                alert(result.error || 'Failed to delete');
            }
        } catch (error) {
            console.error(error);
            alert('Error deleting');
        } finally {
            setProcessing(false);
        }
    };

    const handleSaveCategory = async () => {
        setProcessing(true);
        try {
            if (!categoryForm.name) {
                alert('Please provide a category name');
                setProcessing(false);
                return;
            }

            const payload = {
                ...categoryForm,
                sortOrder: Number(categoryForm.sortOrder || categories.length),
            };

            const method = payload.categoryId ? 'PATCH' : 'POST';
            
            const res = await fetch(`/api/menu-management/vendor/${vendorId}/categories`, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            
            const result = await res.json();
            if (result.success) {
                setCategoryModal({ open: false, category: null });
                fetchData();
            } else {
                alert(result.error || 'Failed to save category');
            }
        } catch (error) {
            console.error(error);
            alert('Error saving category');
        } finally {
            setProcessing(false);
        }
    };

    const filteredItems = items.filter(item => 
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
        item.categoryName.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const openItemModal = (item?: AdminMenuItem) => {
        if (item) {
            setItemForm({ ...item });
        } else {
            setItemForm({
                isVeg: true,
                isAvailable: true,
                isBestSeller: false,
                preparationTime: 15,
                variants: [],
                addOns: [],
                mealCombos: [],
                tags: []
            });
        }
        setItemModal({ open: true, item: item || null });
    };

    const openCategoryModal = (category?: VendorCategory) => {
        if (category) {
            setCategoryForm({ ...category });
        } else {
            setCategoryForm({
                isActive: true,
                sortOrder: categories.length
            });
        }
        setCategoryModal({ open: true, category: category || null });
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="w-8 h-8 animate-spin text-[var(--primary)]" />
                    <p className="text-[var(--foreground-secondary)] font-medium">Loading vendor menu...</p>
                </div>
            </div>
        );
    }

    return (
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div className="flex items-center gap-4">
                <button onClick={() => router.back()} className="btn btn-ghost btn-icon-sm p-2 bg-[var(--surface-hover)] rounded-lg">
                    <ArrowLeft size={18} />
                </button>
                <div>
                    <h1 className="page-title" style={{ fontSize: '1.5rem', marginBottom: 0 }}>Vendor Menu Management</h1>
                    <div className="flex items-center gap-3 mt-1.5">
                        {vendor?.shopImageUrl || vendor?.profileImageUrl ? (
                            <img 
                                src={vendor.shopImageUrl || vendor.profileImageUrl} 
                                alt={vendor?.shopName || vendor?.fullName || 'Vendor'} 
                                className="w-6 h-6 rounded-md object-cover border border-[var(--border)] shadow-sm"
                            />
                        ) : (
                            <div className="w-6 h-6 rounded-md bg-[var(--surface-hover)] border border-[var(--border)] flex items-center justify-center">
                                <Store size={14} className="text-[var(--foreground-secondary)]" />
                            </div>
                        )}
                        <span className="text-sm font-semibold text-[var(--foreground-secondary)] flex items-center gap-2">
                            {vendor?.shopName || vendor?.fullName || `Vendor: ${vendorId}`}
                            <span className="text-xs font-normal opacity-60 bg-[var(--surface-hover)] px-1.5 py-0.5 rounded">ID: {vendorId}</span>
                        </span>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-[var(--border)] gap-6">
                <button 
                    onClick={() => setActiveTab('items')} 
                    className={`pb-3 font-semibold text-sm transition-colors relative ${activeTab === 'items' ? 'text-[var(--primary)]' : 'text-[var(--foreground-secondary)]'}`}
                >
                    Menu Items
                    {activeTab === 'items' && <motion.div layoutId="tab-indicator" className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--primary)] rounded-t-full" />}
                </button>
                <button 
                    onClick={() => setActiveTab('categories')} 
                    className={`pb-3 font-semibold text-sm transition-colors relative ${activeTab === 'categories' ? 'text-[var(--primary)]' : 'text-[var(--foreground-secondary)]'}`}
                >
                    Categories
                    {activeTab === 'categories' && <motion.div layoutId="tab-indicator" className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--primary)] rounded-t-full" />}
                </button>
            </div>

            {/* Actions Bar */}
            <div className="flex flex-col sm:flex-row justify-between gap-4">
                {activeTab === 'items' && (
                    <div className="input-group max-w-md">
                        <Search size={18} className="input-icon" />
                        <input
                            type="text"
                            placeholder="Search items..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="input"
                        />
                    </div>
                )}
                <div className="flex-1" />
                
                {activeTab === 'items' ? (
                    <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
                        <button onClick={() => setShowBulkImage(true)} className="btn btn-outline text-sm px-4 py-2.5 bg-[var(--surface)] hover:bg-[var(--surface-hover)] border border-[var(--border)] rounded-xl transition-all shadow-sm hover:shadow flex items-center gap-2 text-[var(--foreground)]">
                            <ImageIcon2 size={16} className="text-blue-500" /> <span className="hidden sm:inline font-bold">Bulk Images</span>
                        </button>
                        <button onClick={() => setShowCsvImport(true)} className="btn btn-outline text-sm px-4 py-2.5 bg-[var(--surface)] hover:bg-[var(--surface-hover)] border border-[var(--border)] rounded-xl transition-all shadow-sm hover:shadow flex items-center gap-2 text-[var(--foreground)]">
                            <FileSpreadsheet size={16} className="text-emerald-600" /> <span className="hidden sm:inline font-bold">Import CSV</span>
                        </button>
                        <button onClick={() => setShowQuickAdd(true)} className="btn btn-outline text-sm px-4 py-2.5 bg-[var(--surface)] hover:bg-[var(--surface-hover)] border border-[var(--border)] rounded-xl transition-all shadow-sm hover:shadow flex items-center gap-2 text-[var(--foreground)]">
                            <Zap size={16} className="text-amber-500" /> <span className="hidden sm:inline font-bold">Quick Add</span>
                        </button>
                        <button onClick={() => openItemModal()} className="btn btn-primary text-sm px-5 py-2.5 rounded-xl transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5 flex items-center gap-2 font-bold flex-1 lg:flex-none justify-center">
                            <Plus size={18} /> Add Item
                        </button>
                    </div>
                ) : (
                    <button onClick={() => openCategoryModal()} className="btn btn-primary text-sm px-4 py-2 rounded-lg font-bold flex items-center gap-2">
                        <Plus size={16} /> Add Category
                    </button>
                )}
            </div>

            {/* Content Lists */}
            {activeTab === 'items' && (
                <div className="grid gap-3">
                    {filteredItems.length === 0 ? (
                        <div className="empty-state glass-card p-12 text-center">
                            <UtensilsCrossed size={32} className="mx-auto text-[var(--foreground-secondary)] mb-4" />
                            <h3 className="empty-state-title">No menu items found</h3>
                        </div>
                    ) : (
                        filteredItems.map(item => (
                            <div key={item.itemId} className="glass-card p-4 flex items-center gap-4">
                                <div className="w-16 h-16 rounded-lg bg-[var(--surface-hover)] overflow-hidden shrink-0 flex items-center justify-center">
                                    {item.imageUrl ? <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" /> : <ImageIcon2 size={20} className="text-[var(--foreground-secondary)]" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <div className={`w-3 h-3 rounded-sm border-[1.5px] flex items-center justify-center shrink-0 ${item.isVeg ? 'border-green-500' : 'border-red-500'}`}>
                                            <div className={`w-1.5 h-1.5 rounded-full ${item.isVeg ? 'bg-green-500' : 'bg-red-500'}`} />
                                        </div>
                                        <h4 className="font-bold truncate">{item.name}</h4>
                                        {item.isBestSeller && <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded border border-amber-200">Best Seller</span>}
                                        {!item.imageUrl && <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded border border-red-200 ml-2" title="Please edit this item to upload an image">Missing Image</span>}
                                    </div>
                                    <div className="flex items-center gap-3 mt-1 text-xs text-[var(--foreground-secondary)]">
                                        <span className="font-bold text-[var(--foreground)]">₹{item.price}</span>
                                        <span>•</span>
                                        <span>{item.categoryName}</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${item.isAvailable ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                                        {item.isAvailable ? 'Available' : 'Unavailable'}
                                    </span>
                                    <button onClick={() => openItemModal(item)} className="p-2 hover:bg-[var(--surface-hover)] rounded-lg transition-colors text-blue-500">
                                        <Edit3 size={18} />
                                    </button>
                                    <button onClick={() => setDeleteModal({ open: true, type: 'item', id: item.itemId })} className="p-2 hover:bg-[var(--surface-hover)] rounded-lg transition-colors text-red-500">
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}

            {activeTab === 'categories' && (
                <div className="grid gap-3">
                    {categories.length === 0 ? (
                        <div className="empty-state glass-card p-12 text-center">
                            <h3 className="empty-state-title">No categories found</h3>
                        </div>
                    ) : (
                        categories.map(cat => (
                            <div key={cat.categoryId} className="glass-card p-4 flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-lg bg-[var(--surface-hover)] flex items-center justify-center font-bold text-[var(--foreground-secondary)]">
                                        {cat.sortOrder}
                                    </div>
                                    <div>
                                        <h4 className="font-bold">{cat.name}</h4>
                                        <p className="text-xs text-[var(--foreground-secondary)]">{cat.description || 'No description'}</p>
                                        <p className="text-xs text-[var(--primary)] font-medium mt-1">{items.filter(i => i.categoryId === cat.categoryId).length} item(s)</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${cat.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                                        {cat.isActive ? 'Active' : 'Inactive'}
                                    </span>
                                    <button onClick={() => openCategoryModal(cat)} className="p-2 hover:bg-[var(--surface-hover)] rounded-lg transition-colors text-blue-500">
                                        <Edit3 size={18} />
                                    </button>
                                    <button onClick={() => setDeleteModal({ open: true, type: 'category', id: cat.categoryId })} className="p-2 hover:bg-[var(--surface-hover)] rounded-lg transition-colors text-red-500">
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}

            {/* Modals */}
            <AnimatePresence>
                {showBulkImage && <BulkImageUpload key="bulk-image" vendorId={vendorId} items={items} onClose={() => { setShowBulkImage(false); fetchData(); }} />}
                {showCsvImport && <CsvImport key="csv-import" vendorId={vendorId} categories={categories} onClose={() => { setShowCsvImport(false); fetchData(); }} />}
                {showQuickAdd && <QuickAdd key="quick-add" vendorId={vendorId} categories={categories} onClose={() => { setShowQuickAdd(false); fetchData(); }} />}

                {/* Item Modal */}
                {itemModal.open && (
                    <motion.div key="item-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] bg-[var(--background)] flex flex-col overflow-hidden">
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full h-full flex flex-col">
                            
                            {/* Header */}
                            <div className="px-8 py-6 border-b border-[var(--border)] flex justify-between items-center">
                                <div>
                                    <h2 className="text-xl font-bold text-[var(--foreground)] tracking-tight">
                                        {itemModal.item ? 'Edit Menu Item' : 'Create New Menu Item'}
                                    </h2>
                                    <p className="text-sm font-medium text-[var(--foreground-secondary)] mt-1">Configure identity, pricing, and powerful customizations.</p>
                                </div>
                                <button onClick={() => setItemModal({ open: false, item: null })} className="p-2 hover:bg-[var(--surface-hover)] rounded-md transition-colors"><X size={24} /></button>
                            </div>
                            
                            {/* Scrollable Body */}
                            <div className="p-6 lg:p-8 overflow-y-auto flex-1 custom-scrollbar">
                                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                                    
                                    {/* Left Column: Core Identity */}
                                    <div className="lg:col-span-5 flex flex-col gap-8">
                                        
                                        {/* Basic Info Glass Card */}
                                        <div className="p-6 md:p-8 flex flex-col gap-6 rounded-lg border border-[var(--border)]">
                                            <h3 className="font-bold border-b border-[var(--border)] pb-4 flex items-center gap-3 text-[var(--foreground)] text-lg">
                                                <UtensilsCrossed size={20} className="text-[var(--primary)]" />
                                                Core Identity
                                            </h3>
                                            
                                            <div className="flex flex-col gap-6 mt-4">
                                                <div>
                                                    <label className="block text-xs font-bold mb-2 text-[var(--foreground-secondary)] uppercase tracking-wider">Item Name *</label>
                                                    <input type="text" className="input w-full bg-[var(--surface-hover)] font-bold text-lg border-transparent focus:border-[var(--primary)] transition-all px-5 py-3.5 rounded-xl" value={itemForm.name || ''} onChange={e => setItemForm({...itemForm, name: e.target.value})} placeholder="e.g. Signature Truffle Burger" />
                                                </div>
                                                
                                                <div>
                                                    <label className="block text-xs font-bold mb-2 text-[var(--foreground-secondary)] uppercase tracking-wider">Mouth-watering Description</label>
                                                    <textarea className="input w-full resize-y bg-[var(--surface-hover)] text-sm font-medium leading-relaxed border-transparent focus:border-[var(--primary)] transition-all px-5 py-4 rounded-xl" value={itemForm.description || ''} onChange={e => setItemForm({...itemForm, description: e.target.value})} placeholder="Describe the ingredients, taste, and what makes it special..." rows={3} />
                                                </div>

                                                <div className="grid grid-cols-2 gap-5">
                                                    <div>
                                                        <label className="block text-xs font-bold mb-2 text-[var(--foreground-secondary)] uppercase tracking-wider">Food Type *</label>
                                                        <select className="input w-full bg-[var(--surface-hover)] font-bold border-transparent focus:border-[var(--primary)] px-5 py-3.5 rounded-xl transition-all" value={itemForm.isVeg ? 'veg' : 'nonveg'} onChange={e => setItemForm({...itemForm, isVeg: e.target.value === 'veg'})}>
                                                            <option value="veg">🟢 Pure Veg</option>
                                                            <option value="nonveg">🔴 Non-Veg</option>
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs font-bold mb-2 text-[var(--foreground-secondary)] uppercase tracking-wider">Prep Time *</label>
                                                        <div className="relative">
                                                            <input type="number" className="input w-full bg-[var(--surface-hover)] font-bold border-transparent focus:border-[var(--primary)] pl-5 pr-12 py-3.5 rounded-xl transition-all" value={itemForm.preparationTime || ''} onChange={e => setItemForm({...itemForm, preparationTime: Number(e.target.value)})} min="1" placeholder="15" />
                                                            <span className="absolute right-5 top-1/2 -translate-y-1/2 text-xs text-[var(--foreground-secondary)] font-black tracking-widest">MIN</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div>
                                                    <label className="block text-xs font-bold mb-2 text-[var(--foreground-secondary)] uppercase tracking-wider">Hero Image *</label>
                                                    <div className="flex flex-col gap-4">
                                                        {itemForm.imageUrl ? (
                                                            <div className="w-full h-56 rounded-2xl bg-[var(--surface-hover)] overflow-hidden border-2 border-[var(--border)] flex items-center justify-center relative group/img shadow-inner">
                                                                <img src={itemForm.imageUrl} alt="Preview" className="w-full h-full object-cover" />
                                                                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                                                                    <label htmlFor="image-upload" className="btn border border-white/40 text-white hover:bg-white/20 cursor-pointer font-bold px-6 py-2 rounded-lg">
                                                                        Change Image
                                                                    </label>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <label htmlFor="image-upload" className="w-full h-40 rounded-lg border border-dashed border-[var(--border)] flex flex-col items-center justify-center gap-3 cursor-pointer hover:bg-[var(--surface-hover)] text-[var(--foreground-secondary)]">
                                                                {uploading ? <Loader2 className="w-8 h-8 animate-spin text-[var(--primary)]" /> : <ImageIcon2 size={32} className="opacity-50" />}
                                                                <span className="text-sm font-bold">{uploading ? 'Uploading...' : 'Click to upload image'}</span>
                                                            </label>
                                                        )}
                                                        <input type="file" accept="image/*" className="hidden" id="image-upload" onChange={async (e) => {
                                                            const file = e.target.files?.[0];
                                                            if (file) {
                                                                const url = await handleImageUpload(file);
                                                                if (url) {
                                                                    setItemForm({...itemForm, imageUrl: url});
                                                                    showToast('Hero image uploaded masterfully!');
                                                                }
                                                            }
                                                        }} />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Pricing & Category */}
                                        <div className="p-6 md:p-8 flex flex-col gap-6 rounded-lg border border-[var(--border)]">
                                            <h3 className="font-bold border-b border-[var(--border)] pb-4 flex items-center gap-3 text-[var(--foreground)] text-lg">
                                                <DollarSign size={20} className="text-[var(--primary)]" />
                                                Pricing & Placement
                                            </h3>
                                            
                                            <div className="flex flex-col gap-6 mt-4">
                                                <div className="grid grid-cols-2 gap-5">
                                                    <div>
                                                        <label className="block text-xs font-bold mb-2 text-[var(--foreground-secondary)] uppercase tracking-wider">Base Price *</label>
                                                        <div className="relative group/price">
                                                            <span className="absolute left-5 top-1/2 -translate-y-1/2 text-xl font-black text-emerald-600 transition-colors">₹</span>
                                                            <input type="number" className="input w-full bg-emerald-50/50 dark:bg-emerald-500/5 font-black text-2xl text-emerald-600 border-transparent focus:border-emerald-500 focus:bg-emerald-50 dark:focus:bg-emerald-500/10 pl-10 pr-4 py-3.5 rounded-xl transition-all" value={itemForm.price || ''} onChange={e => setItemForm({...itemForm, price: Number(e.target.value)})} min="0" placeholder="0" />
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs font-bold mb-2 text-[var(--foreground-secondary)] uppercase tracking-wider">Discount</label>
                                                        <div className="relative">
                                                            <input type="number" className="input w-full bg-[var(--surface-hover)] font-bold text-xl border-transparent focus:border-emerald-500 pl-5 pr-12 py-3.5 rounded-xl transition-all" value={itemForm.discount || ''} onChange={e => setItemForm({...itemForm, discount: Number(e.target.value)})} min="0" max="100" placeholder="0" />
                                                            <span className="absolute right-5 top-1/2 -translate-y-1/2 text-lg font-black text-[var(--foreground-secondary)]">%</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-2 gap-5">
                                                    <div>
                                                        <label className="block text-xs font-bold mb-2 text-[var(--foreground-secondary)] uppercase tracking-wider">Master Category *</label>
                                                        <select className="input w-full bg-[var(--surface-hover)] font-bold border-transparent focus:border-emerald-500 px-5 py-3.5 rounded-xl transition-all" value={itemForm.categoryId || ''} onChange={e => setItemForm({...itemForm, categoryId: e.target.value})}>
                                                            <option value="">Select Category...</option>
                                                            {categories.map(c => (
                                                                <option key={c.categoryId} value={c.categoryId}>{c.name}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs font-bold mb-2 text-[var(--foreground-secondary)] uppercase tracking-wider">Sub-category</label>
                                                        <input type="text" className="input w-full bg-[var(--surface-hover)] font-bold border-transparent focus:border-emerald-500 px-5 py-3.5 rounded-xl transition-all" value={itemForm.subCategoryName || ''} onChange={e => setItemForm({...itemForm, subCategoryName: e.target.value})} placeholder="e.g. Starters" />
                                                    </div>
                                                </div>

                                                <div className="pt-2 flex flex-col gap-4">
                                                    <label className="flex items-center justify-between p-4 rounded-lg border border-[var(--border)] cursor-pointer">
                                                        <div>
                                                            <span className="block font-bold text-[var(--foreground)]">Available for Order</span>
                                                            <span className="block text-xs text-[var(--foreground-secondary)] mt-0.5">Toggle if item is in stock right now</span>
                                                        </div>
                                                        <div className="relative inline-block w-10 mr-2 align-middle select-none">
                                                            <input type="checkbox" checked={itemForm.isAvailable} onChange={e => setItemForm({...itemForm, isAvailable: e.target.checked})} className="toggle-checkbox absolute block w-5 h-5 rounded-full bg-white border-2 border-[var(--border)] appearance-none cursor-pointer transition-transform duration-300 ease-in-out checked:translate-x-5 checked:border-[var(--primary)]" style={{ backgroundColor: itemForm.isAvailable ? 'var(--primary)' : 'var(--foreground-secondary)' }} />
                                                            <div className="toggle-label block overflow-hidden h-5 rounded-full bg-[var(--surface-hover)] cursor-pointer border border-[var(--border)] transition-colors duration-300" style={{ borderColor: itemForm.isAvailable ? 'var(--primary)' : 'var(--border)' }}></div>
                                                        </div>
                                                    </label>

                                                    <label className="flex items-center justify-between p-4 rounded-lg border border-[var(--border)] cursor-pointer">
                                                        <div>
                                                            <span className="block font-bold text-[var(--foreground)]">Highlight as Best Seller</span>
                                                            <span className="block text-xs text-[var(--foreground-secondary)] mt-0.5">Adds a special badge in the customer app</span>
                                                        </div>
                                                        <div className="relative inline-block w-10 mr-2 align-middle select-none">
                                                            <input type="checkbox" checked={itemForm.isBestSeller} onChange={e => setItemForm({...itemForm, isBestSeller: e.target.checked})} className="toggle-checkbox absolute block w-5 h-5 rounded-full bg-white border-2 border-[var(--border)] appearance-none cursor-pointer transition-transform duration-300 ease-in-out checked:translate-x-5 checked:border-amber-500" style={{ backgroundColor: itemForm.isBestSeller ? '#f59e0b' : 'var(--foreground-secondary)' }} />
                                                            <div className="toggle-label block overflow-hidden h-5 rounded-full bg-[var(--surface-hover)] cursor-pointer border border-[var(--border)] transition-colors duration-300" style={{ borderColor: itemForm.isBestSeller ? '#f59e0b' : 'var(--border)' }}></div>
                                                        </div>
                                                    </label>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Right Column: Customizations */}
                                    <div className="lg:col-span-7 flex flex-col gap-8">
                                        <div className="p-6 md:p-8 flex flex-col gap-8 rounded-lg border border-[var(--border)] h-full">
                                            <div className="flex items-center justify-between border-b border-[var(--border)] pb-4">
                                                <h3 className="font-bold flex items-center gap-3 text-[var(--foreground)] text-lg">
                                                    <Package size={20} className="text-[var(--primary)]" />
                                                    Customizations
                                                </h3>
                                                <span className="text-xs font-medium text-[var(--foreground-secondary)]">Optional</span>
                                            </div>
                                            
                                            <div className="flex flex-col gap-10 mt-6">
                                                {/* Variants */}
                                                <div className="flex flex-col gap-5">
                                                    <div className="flex justify-between items-end">
                                                        <div>
                                                            <h4 className="text-base font-black text-[var(--foreground)] flex items-center gap-2">
                                                                <Layers size={18} className="text-[var(--primary)]" /> Variants <span className="font-medium text-[var(--foreground-secondary)] text-sm">(Sizes/Portions)</span>
                                                            </h4>
                                                            <p className="text-sm font-medium text-[var(--foreground-secondary)] mt-1.5">If configured, the <strong className="text-[var(--foreground)]">Base Price</strong> above will be overridden.</p>
                                                        </div>
                                                        <button type="button" onClick={() => setItemForm({...itemForm, variants: [...(itemForm.variants || []), { variantId: Date.now().toString(), name: '', price: 0, isDefault: false }]})} className="btn btn-outline text-sm font-medium px-4 py-2 rounded-lg">
                                                            <Plus size={16} className="mr-1" /> Add Variant
                                                        </button>
                                                    </div>
                                                    
                                                    <div className="flex flex-col gap-3">
                                                        {(!itemForm.variants || itemForm.variants.length === 0) && (
                                                            <div className="p-8 border border-dashed border-[var(--border)] rounded-lg text-center flex flex-col items-center justify-center gap-2">
                                                                <span className="text-[var(--foreground-secondary)] text-sm">No variants configured. Item will solely use Base Price.</span>
                                                            </div>
                                                        )}
                                                        <AnimatePresence>
                                                            {itemForm.variants?.map((v, i) => (
                                                                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, scale: 0.95 }} key={i} className="flex flex-wrap sm:flex-nowrap gap-4 items-center p-4 rounded-lg border border-[var(--border)]">
                                                                    <div className="flex-1 min-w-[200px]">
                                                                        <label className="block text-[10px] font-semibold mb-1 text-[var(--foreground-secondary)] uppercase tracking-wider">Variant Name</label>
                                                                        <input type="text" placeholder="e.g. Large" className="input text-sm w-full bg-transparent border-[var(--border)] rounded px-3 py-2" value={v.name} onChange={e => { const nv = [...(itemForm.variants||[])]; nv[i].name = e.target.value; setItemForm({...itemForm, variants: nv})}} />
                                                                    </div>
                                                                    <div className="w-32 shrink-0">
                                                                        <label className="block text-[10px] font-semibold mb-1 text-[var(--foreground-secondary)] uppercase tracking-wider">Price (₹)</label>
                                                                        <div className="relative">
                                                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--foreground-secondary)]">₹</span>
                                                                            <input type="number" placeholder="0" className="input text-sm w-full pl-8 bg-transparent border-[var(--border)] rounded px-3 py-2" value={v.price} onChange={e => { const nv = [...(itemForm.variants||[])]; nv[i].price = Number(e.target.value); setItemForm({...itemForm, variants: nv})}} />
                                                                        </div>
                                                                    </div>
                                                                    <div className="pt-5">
                                                                        <label className="flex items-center justify-center gap-2 text-sm cursor-pointer shrink-0">
                                                                            <input type="checkbox" checked={v.isDefault} onChange={e => { const nv = [...(itemForm.variants||[])]; nv[i].isDefault = e.target.checked; setItemForm({...itemForm, variants: nv})}} className="w-4 h-4 accent-[var(--primary)] rounded cursor-pointer" /> 
                                                                            Default
                                                                        </label>
                                                                    </div>
                                                                    <div className="pt-5">
                                                                        <button type="button" onClick={() => { const nv = (itemForm.variants||[]).filter((_, idx) => idx !== i); setItemForm({...itemForm, variants: nv})}} className="text-red-500 p-2 hover:bg-red-50 rounded shrink-0"><Trash2 size={18} /></button>
                                                                    </div>
                                                                </motion.div>
                                                            ))}
                                                        </AnimatePresence>
                                                    </div>
                                                </div>

                                                <div className="w-full h-px bg-gradient-to-r from-transparent via-[var(--border)] to-transparent opacity-50"></div>

                                                {/* Add-ons */}
                                                <div className="flex flex-col gap-5">
                                                    <div className="flex justify-between items-end">
                                                        <div>
                                                            <h4 className="text-base font-black text-[var(--foreground)] flex items-center gap-2">
                                                                <Plus size={18} className="text-green-500" /> Optional Add-ons
                                                            </h4>
                                                            <p className="text-sm font-medium text-[var(--foreground-secondary)] mt-1.5">Customers can select multiple add-ons to upgrade their item.</p>
                                                        </div>
                                                        <button type="button" onClick={() => setItemForm({...itemForm, addOns: [...(itemForm.addOns || []), { addOnId: Date.now().toString(), name: '', price: 0, isVeg: true }]})} className="btn btn-outline text-sm font-medium px-4 py-2 rounded-lg">
                                                            <Plus size={16} className="mr-1" /> Add Extra
                                                        </button>
                                                    </div>
                                                    
                                                    <div className="flex flex-col gap-3">
                                                        {(!itemForm.addOns || itemForm.addOns.length === 0) && (
                                                            <div className="p-8 border border-dashed border-[var(--border)] rounded-lg text-center flex flex-col items-center justify-center gap-2">
                                                                <span className="text-[var(--foreground-secondary)] text-sm">No add-ons configured.</span>
                                                            </div>
                                                        )}
                                                        <AnimatePresence>
                                                            {itemForm.addOns?.map((a, i) => (
                                                                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, scale: 0.95 }} key={i} className="flex flex-wrap sm:flex-nowrap gap-4 items-center p-4 rounded-lg border border-[var(--border)]">
                                                                    <div className="flex-1 min-w-[180px]">
                                                                        <label className="block text-[10px] font-semibold mb-1 text-[var(--foreground-secondary)] uppercase tracking-wider">Add-on Name</label>
                                                                        <input type="text" placeholder="e.g. Extra Cheese" className="input text-sm w-full bg-transparent border-[var(--border)] rounded px-3 py-2" value={a.name} onChange={e => { const na = [...(itemForm.addOns||[])]; na[i].name = e.target.value; setItemForm({...itemForm, addOns: na})}} />
                                                                    </div>
                                                                    <div className="w-28 shrink-0">
                                                                        <label className="block text-[10px] font-semibold mb-1 text-[var(--foreground-secondary)] uppercase tracking-wider">Extra (₹)</label>
                                                                        <div className="relative">
                                                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--foreground-secondary)]">+₹</span>
                                                                            <input type="number" placeholder="0" className="input text-sm w-full pl-9 bg-transparent border-[var(--border)] rounded px-3 py-2" value={a.price} onChange={e => { const na = [...(itemForm.addOns||[])]; na[i].price = Number(e.target.value); setItemForm({...itemForm, addOns: na})}} />
                                                                        </div>
                                                                    </div>
                                                                    <div className="w-36 shrink-0">
                                                                        <label className="block text-[10px] font-semibold mb-1 text-[var(--foreground-secondary)] uppercase tracking-wider">Type</label>
                                                                        <select className="input text-sm bg-transparent border-[var(--border)] w-full rounded px-3 py-2" value={a.isVeg ? 'veg' : 'nonveg'} onChange={e => { const na = [...(itemForm.addOns||[])]; na[i].isVeg = e.target.value === 'veg'; setItemForm({...itemForm, addOns: na})}}>
                                                                            <option value="veg">🟢 Veg</option><option value="nonveg">🔴 Non-Veg</option>
                                                                        </select>
                                                                    </div>
                                                                    <div className="pt-5">
                                                                        <button type="button" onClick={() => { const na = (itemForm.addOns||[]).filter((_, idx) => idx !== i); setItemForm({...itemForm, addOns: na})}} className="text-red-500 p-2 hover:bg-red-50 rounded shrink-0"><Trash2 size={18} /></button>
                                                                    </div>
                                                                </motion.div>
                                                            ))}
                                                        </AnimatePresence>
                                                    </div>
                                                </div>

                                                <div className="w-full h-px bg-gradient-to-r from-transparent via-[var(--border)] to-transparent opacity-50"></div>

                                                {/* Meal Combos */}
                                                <div className="flex flex-col gap-5">
                                                    <div className="flex justify-between items-end">
                                                        <div>
                                                            <h4 className="text-base font-black text-[var(--foreground)] flex items-center gap-2">
                                                                <UtensilsCrossed size={18} className="text-orange-500" /> Meal Combos
                                                            </h4>
                                                            <p className="text-sm font-medium text-[var(--foreground-secondary)] mt-1.5">Upsell by seamlessly bundling with drinks, sides, or desserts.</p>
                                                        </div>
                                                        <button type="button" onClick={() => setItemForm({...itemForm, mealCombos: [...(itemForm.mealCombos || []), { comboId: Date.now().toString(), name: '', description: '', extraPrice: 0 }]})} className="btn btn-outline text-sm font-medium px-4 py-2 rounded-lg">
                                                            <Plus size={16} className="mr-1" /> Add Combo
                                                        </button>
                                                    </div>
                                                    
                                                    <div className="flex flex-col gap-4">
                                                        {(!itemForm.mealCombos || itemForm.mealCombos.length === 0) && (
                                                            <div className="p-8 border border-dashed border-[var(--border)] rounded-lg text-center flex flex-col items-center justify-center gap-2">
                                                                <span className="text-[var(--foreground-secondary)] text-sm">No meal combos configured.</span>
                                                            </div>
                                                        )}
                                                        <AnimatePresence>
                                                            {itemForm.mealCombos?.map((m, i) => (
                                                                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, scale: 0.95 }} key={i} className="flex flex-col gap-4 p-4 rounded-lg border border-[var(--border)]">
                                                                    <div className="flex gap-4 items-end w-full">
                                                                        <div className="flex-1">
                                                                            <label className="block text-[10px] font-semibold mb-1 text-[var(--foreground-secondary)] uppercase tracking-wider">Combo Title</label>
                                                                            <input type="text" placeholder="e.g. Make it a meal" className="input text-sm w-full bg-transparent border-[var(--border)] rounded px-3 py-2" value={m.name} onChange={e => { const nm = [...(itemForm.mealCombos||[])]; nm[i].name = e.target.value; setItemForm({...itemForm, mealCombos: nm})}} />
                                                                        </div>
                                                                        <div className="w-32 shrink-0">
                                                                            <label className="block text-[10px] font-semibold mb-1 text-[var(--foreground-secondary)] uppercase tracking-wider">Extra (₹)</label>
                                                                            <div className="relative">
                                                                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--foreground-secondary)]">+₹</span>
                                                                                <input type="number" placeholder="0" className="input text-sm w-full pl-8 bg-transparent border-[var(--border)] rounded px-3 py-2" value={m.extraPrice} onChange={e => { const nm = [...(itemForm.mealCombos||[])]; nm[i].extraPrice = Number(e.target.value); setItemForm({...itemForm, mealCombos: nm})}} />
                                                                            </div>
                                                                        </div>
                                                                        <button type="button" onClick={() => { const nm = (itemForm.mealCombos||[]).filter((_, idx) => idx !== i); setItemForm({...itemForm, mealCombos: nm})}} className="text-red-500 p-2 hover:bg-red-50 rounded shrink-0"><Trash2 size={18} /></button>
                                                                    </div>
                                                                    <div>
                                                                        <label className="block text-[10px] font-semibold mb-1 text-[var(--foreground-secondary)] uppercase tracking-wider">What's included in this combo?</label>
                                                                        <input type="text" placeholder="e.g., Medium Fries + 300ml Coke" className="input text-sm w-full bg-transparent border-[var(--border)] rounded px-3 py-2" value={m.description} onChange={e => { const nm = [...(itemForm.mealCombos||[])]; nm[i].description = e.target.value; setItemForm({...itemForm, mealCombos: nm})}} />
                                                                    </div>
                                                                </motion.div>
                                                            ))}
                                                        </AnimatePresence>
                                                    </div>
                                                </div>

                                                <div className="w-full h-px bg-gradient-to-r from-transparent via-[var(--border)] to-transparent opacity-50"></div>

                                                {/* Search Tags */}
                                                <div className="flex flex-col gap-5">
                                                    <div>
                                                        <h4 className="text-base font-black text-[var(--foreground)] flex items-center gap-2">
                                                            <Tag size={18} className="text-blue-500" /> Search Tags
                                                        </h4>
                                                        <p className="text-sm font-medium text-[var(--foreground-secondary)] mt-1.5">Add tags to improve discoverability in the customer app search bar.</p>
                                                    </div>
                                                    
                                                    <div className="flex flex-col gap-3">
                                                        <div className="flex flex-wrap gap-2 mb-2 p-4 border border-[var(--border)] rounded-lg bg-[var(--surface)] min-h-[60px]">
                                                            {(!itemForm.tags || itemForm.tags.length === 0) && (
                                                                <span className="text-[var(--foreground-secondary)] text-sm flex items-center h-full">No tags added yet.</span>
                                                            )}
                                                            {itemForm.tags?.map((tag, i) => (
                                                                <span key={i} className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400 rounded-full text-sm font-bold">
                                                                    #{tag}
                                                                    <button type="button" onClick={() => {
                                                                        const nt = itemForm.tags?.filter((_, idx) => idx !== i);
                                                                        setItemForm({...itemForm, tags: nt});
                                                                    }} className="hover:text-red-500"><X size={14}/></button>
                                                                </span>
                                                            ))}
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <input 
                                                                type="text" 
                                                                placeholder="Type a custom tag and click add..." 
                                                                className="input text-sm flex-1 bg-transparent border-[var(--border)] rounded-lg px-4 py-2" 
                                                                value={newTagInput} 
                                                                onChange={e => setNewTagInput(e.target.value)} 
                                                                onKeyDown={e => {
                                                                    if (e.key === 'Enter') {
                                                                        e.preventDefault();
                                                                        const val = newTagInput.trim().toLowerCase();
                                                                        if (val && !(itemForm.tags || []).includes(val)) {
                                                                            setItemForm({...itemForm, tags: [...(itemForm.tags || []), val]});
                                                                            setNewTagInput('');
                                                                        }
                                                                    }
                                                                }}
                                                            />
                                                            <button 
                                                                type="button" 
                                                                onClick={() => {
                                                                    const val = newTagInput.trim().toLowerCase();
                                                                    if (val && !(itemForm.tags || []).includes(val)) {
                                                                        setItemForm({...itemForm, tags: [...(itemForm.tags || []), val]});
                                                                        setNewTagInput('');
                                                                    }
                                                                }} 
                                                                className="btn btn-primary px-4 py-2 text-sm rounded-lg"
                                                            >
                                                                Add
                                                            </button>
                                                        </div>
                                                        <div className="mt-4">
                                                            <p className="text-xs font-bold mb-2 text-[var(--foreground-secondary)] uppercase tracking-wider">Quick Add Tags</p>
                                                            <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto custom-scrollbar pr-2">
                                                                {AVAILABLE_TAGS.map(tag => {
                                                                    const isSelected = (itemForm.tags || []).includes(tag);
                                                                    return (
                                                                        <button 
                                                                            key={tag} 
                                                                            type="button" 
                                                                            onClick={() => {
                                                                                if (isSelected) {
                                                                                    setItemForm({...itemForm, tags: itemForm.tags?.filter(t => t !== tag)});
                                                                                } else {
                                                                                    setItemForm({...itemForm, tags: [...(itemForm.tags || []), tag]});
                                                                                }
                                                                            }}
                                                                            className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${isSelected ? 'bg-[var(--primary)] border-[var(--primary)] text-white' : 'bg-transparent border-[var(--border)] text-[var(--foreground-secondary)] hover:border-[var(--primary)] hover:text-[var(--primary)]'}`}
                                                                        >
                                                                            {tag}
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>

                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            {/* Footer Actions */}
                            <div className="px-8 py-5 border-t border-[var(--border)] bg-[var(--surface)] flex justify-end gap-5">
                                <button onClick={() => setItemModal({ open: false, item: null })} className="btn btn-outline hover:bg-[var(--surface-hover)] px-8 py-3 rounded-xl font-medium transition-colors">Cancel</button>
                                <button onClick={handleSaveItem} disabled={processing || uploading} className="btn btn-primary px-12 py-3 rounded-xl font-medium text-white transition-all disabled:opacity-50 disabled:hover:translate-y-0">
                                    {processing ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : <span>Save Menu Item</span>}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}

                {/* Category Modal */}
                {categoryModal.open && (
                    <motion.div key="category-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
                        <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-md overflow-hidden flex flex-col shadow-xl">
                            <div className="p-5 border-b border-[var(--border)] flex justify-between items-center bg-[var(--surface-hover)]">
                                <h2 className="text-lg font-bold">{categoryModal.category ? 'Edit Category' : 'Add Category'}</h2>
                                <button onClick={() => setCategoryModal({ open: false, category: null })} className="p-1 hover:bg-[var(--surface)] rounded-md"><X size={20} /></button>
                            </div>
                            <div className="p-6 space-y-4">
                                <div>
                                    <label className="block text-xs font-semibold mb-1 text-[var(--foreground-secondary)]">Name *</label>
                                    <input type="text" className="input w-full" value={categoryForm.name || ''} onChange={e => setCategoryForm({...categoryForm, name: e.target.value})} />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold mb-1 text-[var(--foreground-secondary)]">Description</label>
                                    <textarea className="input w-full" value={categoryForm.description || ''} onChange={e => setCategoryForm({...categoryForm, description: e.target.value})} rows={2} />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-semibold mb-1 text-[var(--foreground-secondary)]">Sort Order</label>
                                        <input type="number" className="input w-full" value={categoryForm.sortOrder || ''} onChange={e => setCategoryForm({...categoryForm, sortOrder: Number(e.target.value)})} />
                                    </div>
                                    <div className="flex items-center mt-6">
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input type="checkbox" checked={categoryForm.isActive} onChange={e => setCategoryForm({...categoryForm, isActive: e.target.checked})} className="w-4 h-4 accent-[var(--primary)]" />
                                            <span className="text-sm font-semibold">Active</span>
                                        </label>
                                    </div>
                                </div>
                            </div>
                            <div className="p-5 border-t border-[var(--border)] bg-[var(--surface-hover)] flex justify-end gap-3">
                                <button onClick={() => setCategoryModal({ open: false, category: null })} className="btn btn-outline bg-[var(--surface)]">Cancel</button>
                                <button onClick={handleSaveCategory} disabled={processing} className="btn btn-primary min-w-[100px]">
                                    {processing ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Save Category'}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}

                {/* Delete Confirm Modal */}
                {deleteModal.open && (
                    <motion.div key="delete-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
                        <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-sm overflow-hidden flex flex-col shadow-xl text-center p-6">
                            <div className="w-12 h-12 rounded-full bg-red-100 text-red-500 flex items-center justify-center mx-auto mb-4">
                                <Trash2 size={24} />
                            </div>
                            <h3 className="text-lg font-bold mb-2">Delete {deleteModal.type === 'item' ? 'Menu Item' : 'Category'}</h3>
                            <p className="text-sm text-[var(--foreground-secondary)] mb-6">Are you sure you want to permanently delete this? This action cannot be undone.</p>
                            <div className="flex justify-end gap-3">
                                <button onClick={() => setDeleteModal({ open: false, type: 'item', id: null })} className="btn btn-outline flex-1">Cancel</button>
                                <button onClick={handleDelete} disabled={processing} className="btn bg-red-500 hover:bg-red-600 text-white flex-1 border-none">
                                    {processing ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Delete'}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}

                {toastMsg && (
                    <motion.div key="toast-msg" initial={{ opacity: 0, y: 50, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.9 }} className="fixed bottom-6 right-6 bg-green-600 text-white px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 z-[100] font-bold">
                        <CheckCircle size={20} />
                        {toastMsg}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

