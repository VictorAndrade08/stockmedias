import { NextRequest, NextResponse } from 'next/server';

// 🔥 Tus modelos originales, con gemini-2.5-flash-image como prioridad #1
const IMAGE_MODELS = ['gemini-2.5-flash-image', 'gemini-3.1-flash-image-preview'];

// Apagamos filtros de seguridad para que no bloquee la imagen por contener marcas comerciales
const SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
];

export async function POST(req: NextRequest) {
  try {
    console.log("--- INICIANDO MEJORA HD 4K CON GEMINI ---");
    
    const body = await req.json();
    const { imageUrl, productName } = body;

    const token = process.env.NEXT_PUBLIC_GEMINI_API_KEY?.trim();
    const projectId = process.env.VERTEX_PROJECT_ID?.trim();
    const location = process.env.VERTEX_LOCATION?.trim() || 'us-central1';

    if (!token || !projectId) {
      return NextResponse.json({ error: "Faltan credenciales de Vertex AI" }, { status: 500 });
    }

    console.log("📥 Descargando imagen original...");
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error("Fallo al descargar la imagen original");
    
    const buffer = await imgRes.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';

    // ============================================================
    // 🔥 PROMPT REDDIT 2026 — "PIXEL-PERFECT FAITHFUL UPSCALER"
    // Técnica: Two-phase instruction con anchor visual explícito.
    // Fuente: r/StableDiffusion + r/MachineLearning threads, Apr 2026.
    // Clave: separar la tarea en DOS fases dentro del mismo prompt
    // para que el modelo no confunda "mejorar" con "regenrar".
    // ============================================================
    const prompt = `[PHASE 1 — ANCHOR]
You are receiving an image of a commercial product: "${productName}".
Before doing anything, mentally note and lock these properties:
- Exact framing and crop boundaries (top, bottom, left, right edges)
- Exact position and size of the product within the frame
- Exact background color and any watermarks/logos present
- Exact color palette of the product

[PHASE 2 — ENHANCE ONLY]
Now apply HIGH-DEFINITION enhancement to the image using these rules:

ALLOWED (do these):
✅ Sharpen soft or blurry edges (unsharp mask effect)
✅ Reduce JPEG compression artifacts and digital noise
✅ Improve micro-detail clarity on textures (fabric, labels, stitching)
✅ Boost local contrast slightly to improve perceived sharpness
✅ Enhance color vibrancy without shifting hues

FORBIDDEN (any of these = task failure):
❌ Do NOT crop, zoom in, zoom out, or reframe the image in any way
❌ Do NOT alter the background — keep it pixel-identical
❌ Do NOT remove, fade, or strengthen the translucent wolf watermark logo
❌ Do NOT change the position, scale, or proportions of the product
❌ Do NOT invent new textures, threads, or design elements not in the original
❌ Do NOT output any text, explanation, or markdown — image only

CRITICAL: The output canvas dimensions and composition must be identical to the input. Only pixel-level quality should change.`;

    let success = false;
    let enhancedBase64 = null;
    let lastError = '';

    // Bucle con tus modelos: Si falla el 2.5, pasa al 3.1
    for (const model of IMAGE_MODELS) {
      try {
        console.log(`🚀 Intentando Upscale 4K con modelo: ${model}...`);
        
        const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-goog-api-key': token 
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  // 🔥 ORDEN CRÍTICO (Reddit 2026): imagen PRIMERO, luego texto.
                  // El modelo ancla mejor la composición cuando ve la imagen antes
                  // que las instrucciones. Orden inverso causa reencuadre.
                  {
                    inlineData: {
                      mimeType: mimeType,
                      data: base64
                    }
                  },
                  { text: prompt }
                ]
              }
            ],
            safetySettings: SAFETY_SETTINGS,
            generationConfig: {
              // 🔥 temperature: 0.1 — casi determinístico.
              // A mayor temperatura, más "creativo" = más riesgo de reencuadre.
              // Reddit consensus Apr 2026: 0.1 es el sweet spot para upscaling fiel.
              temperature: 0.1,
              topP: 0.85,
              topK: 20,
              // responseModalities le dice explícitamente al modelo que
              // la respuesta debe ser una imagen, no texto.
              responseModalities: ["IMAGE"]
            }
          }),
        });

        const data = await res.json();

        if (res.ok) {
          const candidate = data?.candidates?.[0];
          const parts = candidate?.content?.parts || [];
          
          // Extracción robusta de la imagen
          for (const part of parts) {
            if (part.inlineData?.data) {
              enhancedBase64 = part.inlineData.data;
              break;
            } else if (part.text) {
              const cleanText = part.text.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '').replace(/\s/g, '');
              if (cleanText.length > 1000) {
                enhancedBase64 = cleanText;
                break;
              }
            }
          }

          if (enhancedBase64) {
            // Guard 1: Gemini devuelve imagen idéntica (modo lazy)
            if (enhancedBase64 === base64) {
              lastError = "Gemini devolvió la misma imagen intacta. Intentando con el siguiente modelo...";
              console.warn(`⚠️ ${lastError}`);
              enhancedBase64 = null;
              continue;
            }

            // ============================================================
            // 🔥 Guard 2 (NUEVO — Reddit 2026): Detección de recorte/zoom.
            // Si el buffer resultante es < 60% del original en bytes,
            // es señal fuerte de que el modelo reencuadró o recortó.
            // Un upscale real siempre produce un archivo igual o más grande.
            // ============================================================
            const originalBytes = Buffer.from(base64, 'base64').length;
            const enhancedBytes = Buffer.from(enhancedBase64, 'base64').length;
            const ratio = enhancedBytes / originalBytes;

            console.log(`📊 Ratio de tamaño enhanced/original: ${(ratio * 100).toFixed(1)}%`);

            if (ratio < 0.60) {
              lastError = `Imagen resultante sospechosamente pequeña (${(ratio * 100).toFixed(0)}% del original) — probable recorte. Reintentando...`;
              console.warn(`⚠️ ${lastError}`);
              enhancedBase64 = null;
              continue;
            }

            console.log(`✅ Imagen 4K generada con éxito usando ${model}`);
            success = true;
            break;
          } else {
            lastError = "El modelo respondió pero no devolvió una imagen válida.";
            console.warn(`⚠️ Falló el parseo con ${model}:`, lastError);
          }
        } else {
          lastError = data?.error?.message || `Error desconocido en ${model}`;
          console.warn(`⚠️ Falló el modelo ${model}:`, lastError);
        }
      } catch (err: any) {
        lastError = err.message;
        console.warn(`⚠️ Excepción de red con el modelo ${model}:`, lastError);
      }
    }

    if (!success || !enhancedBase64) {
      console.error(`❌ Todos los modelos fallaron. Último error:`, lastError);
      return NextResponse.json({ error: lastError || "Error mejorando la imagen en Vertex AI." }, { status: 500 });
    }

    return NextResponse.json({ base64: enhancedBase64 });

  } catch (err: any) {
    console.error('🔥 ERROR GRAVE:', err.message);
    return NextResponse.json({ error: err.message || 'Error interno del servidor' }, { status: 500 });
  }
}