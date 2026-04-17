import { NextRequest, NextResponse } from 'next/server';

const SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
];

// Modelos oficiales de Vertex AI
const TEXT_MODELS = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-2.5-pro']; 

export async function POST(req: NextRequest) {
  try {
    console.log("--- INICIANDO VERTEX AI (GENERACIÓN DE NOMBRES) ---");
    
    const body = await req.json();
    const { currentText, existingNames, imageUrl } = body;

    const token = process.env.NEXT_PUBLIC_GEMINI_API_KEY?.trim();
    const projectId = process.env.VERTEX_PROJECT_ID?.trim();
    const location = process.env.VERTEX_LOCATION?.trim() || 'us-central1';

    // Validaciones de seguridad de Vertex
    if (!token) return NextResponse.json({ error: "Falta API Key de Vertex" }, { status: 500 });
    if (!projectId) {
      console.error("🚨 ERROR CRÍTICO: Falta configurar VERTEX_PROJECT_ID en .env.local");
      return NextResponse.json({ error: "Falta ID de Proyecto Vertex" }, { status: 500 });
    }

    const namesToShow = (existingNames || []).slice(0, 10).join(', ');

    const prompt = `Eres el catalogador experto de 'SocksManager', tienda de calcetines/medias.
IMAGEN (Prioridad 1): Analiza la foto adjunta (busca marcas como PlayStation, logos, colores).
TEXTO DEL USUARIO (Prioridad 2): "${currentText || 'Sin texto'}". Combínalo con lo que ves.
ESTILO ACTUAL: ${namesToShow || 'N/A'}.

TAREA: Genera 3 a 5 nombres cortos (máx 6 palabras). Separados SOLO por |.
Ejemplo: PlayStation Medias Grises Logo | Calcetines PlayStation Gamer | Medias Gamer Gris`;

    const parts: any[] = [{ text: prompt }];

    // Procesamiento rápido de imagen
    if (imageUrl) {
      try {
        console.log("📥 Descargando imagen para Vertex...");
        const imgRes = await fetch(imageUrl);
        if (!imgRes.ok) throw new Error("Fallo al descargar la imagen");
        
        const buffer = await imgRes.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
        
        // Formato estricto camelCase exigido por Vertex AI
        parts.push({
          inlineData: {
            mimeType: contentType,
            data: base64
          }
        });
        console.log("✅ Imagen procesada.");
      } catch (err: any) {
        console.warn('⚠️ Error con la imagen:', err.message);
      }
    }

    let data = null;
    let success = false;
    let lastError = '';

    // Bucle de conexión a los servidores privados de Vertex AI
    for (const model of TEXT_MODELS) {
      try {
        // ENDPOINT EXCLUSIVO DE VERTEX AI
        const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

        console.log(`🚀 Enviando a Servidor Empresarial Vertex -> ${model}...`);
        
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            // 🔥 EL FIX ESTÁ AQUÍ: Usamos x-goog-api-key en lugar de Bearer
            'x-goog-api-key': token
          },
          body: JSON.stringify({
            contents: [{ role: 'user', parts }],
            safetySettings: SAFETY_SETTINGS
          }),
        });

        data = await res.json();

        if (res.ok) {
          console.log(`✅ Éxito de Vertex con ${model}`);
          success = true;
          break;
        } else {
          lastError = data?.error?.message || "Error desconocido en Vertex";
          console.error(`❌ Vertex rechazó la petición en ${model}:`, JSON.stringify(data, null, 2));
        }
      } catch (err: any) {
        lastError = err.message;
      }
    }

    if (!success) {
      return NextResponse.json({ error: lastError || 'Fallo en todos los modelos Vertex' }, { status: 500 });
    }
    
    // Limpieza
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const suggestions = text
      .replace(/```[\s\S]*?```/g, '')
      .replace(/[*_"]/g, '')
      .replace(/\n/g, '|')
      .replace(/- /g, '')
      .split('|')
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);

    console.log("🎁 Generación Completada:", suggestions);
    return NextResponse.json(suggestions);

  } catch (err: any) {
    console.error('🔥 ERROR GRAVE EN EL SERVIDOR:', err.message);
    return NextResponse.json({ error: err.message || 'Error interno' }, { status: 500 });
  }
}