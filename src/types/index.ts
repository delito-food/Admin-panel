// Firebase Types matching Delito data structure

export interface Vendor {
  vendorId: string;
  fullName: string;
  shopName: string;
  email: string;
  phoneNumber: string;
  profileImageUrl: string;
  address: string;
  city: string;
  pincode: string;
  latitude: number;
  longitude: number;
  gstNumber: string;
  fssaiLicense: string;
  rating: number;
  totalOrders: number;
  isOnline: boolean;
  isVerified: boolean;
  hasCompletedSetup: boolean;
  cuisineTypes: string[];
  deliveryRadius: number;
  minimumOrderAmount: number;
  averageDeliveryTime: number;
  createdAt: string;
  updatedAt: string;
  // Verification fields
  verificationStatus?: 'pending' | 'approved' | 'rejected';
  verificationNotes?: string;
  fssaiLicenseUrl?: string;
  gstDocumentUrl?: string;
  verifiedAt?: string;
  verifiedBy?: string;
}

export interface DeliveryPerson {
  deliveryPersonId: string;
  email: string;
  fullName: string;
  phoneNumber: string;
  vehicleType: string;
  vehicleNumber: string;
  city: string;
  pincode: string;
  isOnline: boolean;
  isAvailable: boolean;
  isVerified: boolean;
  currentOrderId: string | null;
  currentLatitude: number;
  currentLongitude: number;
  rating: number;
  totalDeliveries: number;
  totalEarnings: number;
  createdAt: string;
  updatedAt: string;
  // Verification fields
  verificationStatus?: 'pending' | 'approved' | 'rejected';
  verificationNotes?: string;
  driverLicenseUrl?: string;
  vehicleDocumentUrl?: string;
  profilePhotoUrl?: string;
  verifiedAt?: string;
  verifiedBy?: string;
}

export interface MenuItem {
  itemId: string;
  vendorId: string;
  name: string;
  description: string;
  price: number;
  categoryId: string;
  categoryName: string;
  imageUrl: string;
  isVeg: boolean;
  isAvailable: boolean;
  preparationTime: number;
  rating: number;
  totalOrders: number;
  isBestSeller: boolean;
  discount: number;
  createdAt: string;
  updatedAt: string;
  // Verification fields
  isVerified?: boolean;
  verificationStatus?: 'pending' | 'approved' | 'rejected';
  verificationNotes?: string;
  verifiedAt?: string;
  verifiedBy?: string;
}

export interface Customer {
  customerId: string;
  fullName: string;
  email: string;
  phoneNumber: string;
  profileImageUrl: string;
  addresses: Address[];
  defaultAddressId: string;
  favoriteVendors: string[];
  totalOrders: number;
  createdAt: string;
  updatedAt: string;
}

export interface Address {
  addressId: string;
  label: string;
  fullAddress: string;
  landmark: string;
  city: string;
  pincode: string;
  latitude: number;
  longitude: number;
  isDefault: boolean;
}

export interface Order {
  orderId: string;
  vendorId: string;
  vendorName: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  items: OrderItem[];
  itemNames: string[];
  subtotal: number;
  discount: number;
  deliveryFee: number;
  taxes: number;
  total: number;
  status: OrderStatus;
  paymentMode: string;
  paymentStatus: string;
  deliveryAddress: string;
  deliveryInstructions: string;
  estimatedDeliveryTime: number;
  deliveryPersonId: string | null;
  deliveryPersonName: string;
  deliveryPersonPhone: string;
  vendorAddress: string;
  vendorLatitude: number;
  vendorLongitude: number;
  customerLatitude: number;
  customerLongitude: number;
  rating: number;
  ratingComment: string;
  isRated: boolean;
  createdAt: string;
  acceptedAt: string | null;
  preparingAt: string | null;
  preparedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
}

export interface OrderItem {
  itemId: string;
  name: string;
  price: number;
  quantity: number;
  specialInstructions: string;
}

export type OrderStatus =
  | 'Pending'
  | 'Accepted'
  | 'Declined'
  | 'Preparing'
  | 'Prepared'
  | 'Picked Up'
  | 'Sent for delivery'
  | 'Delivered'
  | 'Cancelled';

export interface SpecialOffer {
  offerId: string;
  vendorId: string;
  title: string;
  description: string;
  imageUrl: string;
  promoCode: string;
  discountPercentage: number;
  isActive: boolean;
  validUntil: string;
  createdAt: string;
}

// Dashboard Stats
export interface DashboardStats {
  totalOrdersToday: number;
  totalRevenue: number;
  activeVendors: number;
  activeDelivery: number;
  pendingVendorVerifications: number;
  pendingDeliveryVerifications: number;
  pendingMenuVerifications: number;
  // Legacy stats object for backward compatibility
  stats?: {
    totalOrders: number;
    totalRevenue: number;
    activeVendors: number;
    activeDelivery: number;
    todayOrders: number;
    weeklyOrderTrend: { day: string; orders: number }[];
  };
  verification?: {
    pendingVendors: number;
    pendingDeliveryPersons: number;
  };
  // Comprehensive analytics
  platformEarnings?: {
    today: EarningsData;
    thisWeek: EarningsData;
    thisMonth: EarningsData;
    allTime: EarningsData;
  };
  ordersOverview?: {
    total: number;
    completed: number;
    pending: number;
    cancelled: number;
    avgOrderValue: number;
  };
  vendorStats?: {
    total: number;
    verified: number;
    suspended: number;
    online: number;
    topPerformers: TopPerformer[];
  };
  deliveryStats?: {
    total: number;
    verified: number;
    suspended: number;
    online: number;
    topPerformers: TopPerformer[];
  };
  customerMetrics?: {
    total: number;
    newThisMonth: number;
    activeThisMonth: number;
    retentionRate: number;
  };
  revenueTrend?: { date: string; revenue: number; orders: number; platformEarnings: number }[];
}

export interface EarningsData {
  totalRevenue: number;
  platformEarnings: number;
  commission: number;
  gst: number;
  deliveryFees: number;
  orderCount: number;
}

export interface TopPerformer {
  id: string;
  name: string;
  totalOrders: number;
  revenue: number;
  rating: number;
}

// Verification Item for unified display
export interface VerificationItem {
  id: string;
  type: 'vendor' | 'delivery' | 'menu';
  name: string;
  imageUrl?: string;
  documentUrl?: string;
  status: 'pending' | 'approved' | 'rejected';
  submittedAt: string;
  details: Record<string, string | number | boolean>;
}
