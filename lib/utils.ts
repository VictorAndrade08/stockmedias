import { Product } from '../types';

export function generateShortCode(): string {
  const chars = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < 5; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export async function uploadImageToR2(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/upload-image', { method: 'POST', body: formData });
  if (!res.ok) throw new Error('Error al subir imagen');
  const data = await res.json();
  return data.url as string;
}

export async function deleteImageFromR2(imageUrl: string) {
  try {
    const filename = imageUrl.split('/').pop();
    if (!filename) return;
    await fetch('/api/delete-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename })
    });
  } catch (err) {
    console.error('Error al borrar imagen:', err);
  }
}

export async function suggestProductName(
  imageUrl: string | null,
  currentText: string,
  existingNames: string[]
): Promise<string[]> {
  try {
    const res = await fetch('/api/suggest-name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        currentText, 
        existingNames, 
        imageUrl 
      })
    });

    if (!res.ok) {
      throw new Error('Error en el servidor al generar nombres');
    }

    const suggestions = await res.json();
    return suggestions;
    
  } catch (err) {
    console.error('Error en suggestProductName:', err);
    throw err;
  }
}