import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { currentText, existingNames, imageUrl } = await req.json();

    const namesToShow = (existingNames || []).slice(0, 20).join(', ');

    const prompt = `Eres un asistente para una tienda de medias/calcetines.
El usuario escribió este texto como nombre o descripción: "${currentText}".
Nombres existentes en el inventario (úsalos como referencia de formato y estilo): ${namesToShow || 'ninguno aún'}.

Sugiere entre 3 y 5 nombres cortos y descriptivos para este producto de medias/calcetines.
- Deben ser concisos (máximo 6 palabras)
- Usar el mismo estilo/formato que los nombres existentes
- Basarse en el texto escrito por el usuario
- Solo devuelve los nombres separados por | sin numeración ni explicación ni markdown.
Ejemplo: Medias Nike Deportivas | Calcetines Compresión Running | Medias Tobilleras Básicas`;

    const parts: any[] = [{ text: prompt }];

    // Si hay imagen, la descargamos desde el servidor (evita CORS)
    if (imageUrl) {
      try {
        const imgRes = await fetch(imageUrl);
        const buffer = await imgRes.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
        parts.push({ inline_data: { mime_type: contentType, data: base64 } });
      } catch (err) {
        console.warn('No se pudo cargar imagen para Gemini:', err);
      }
    }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite-preview-06-17:generateContent?key=${process.env.NEXT_PUBLIC_GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }] }),
      }
    );

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      console.error('Gemini error:', data);
      return NextResponse.json({ error: data?.error?.message || 'Error Gemini' }, { status: 500 });
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const suggestions = text
      .replace(/```[\s\S]*?```/g, '')
      .replace(/[*_]/g, '')
      .replace(/\n/g, '|')
      .replace(/- /g, '')
      .split('|')
      .map((s: string) => s.trim())
      .filter(Boolean);

    return NextResponse.json({ suggestions });
  } catch (err: any) {
    console.error('Error en /api/suggest-name:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}