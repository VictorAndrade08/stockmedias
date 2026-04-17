// /types/index.ts
export interface Product {
  id: string;
  sku?: string;
  name: string;
  cost: number;
  price: number;
  stock: number;
  stock_alert?: number | null;
  avg_cost?: number | null;
  image_url?: string | null;
  imageUrl?: string | null;
  user_id?: string;
}

export interface Restock {
  id: string;
  product_id: string;
  quantity: number;
  unit_cost: number;
  date: string;
  user_id?: string;
}

export interface Sale {
  id: string;
  product_id: string;
  productId: string;
  sale_price: number;
  salePrice: number;
  cost_at_sale: number;
  costAtSale: number;
  quantity: number;
  date: string;
  user_id?: string;
  client_name?: string;
  clientName?: string;
}

export interface PendingOrderItem {
  product_id: string;
  name: string;
  quantity: number;
  sale_price: number;
  cost_at_sale: number;
}

export interface PendingOrder {
  id: string;
  client_name: string;
  items: PendingOrderItem[];
  total_price: number;
  amount_paid: number;
  is_delivered: boolean;
  date: string;
  user_id?: string;
}

export interface DashboardStats {
  totalRevenue: number;
  totalProfit: number;
  itemsSold: number;
}

export interface NewProductState {
  name: string;
  cost: string;
  price: string;
  stock: string;
  imagePreview: string | null;
}

export interface CartItem {
  product: Product;
  quantity: number;
  salePrice: string;
  saleCost: string;
}