import { redirect } from 'next/navigation';

export default function TiendaPage() {
  // Redirige instantáneamente al Home (/) del lado del servidor
  redirect('/');
}