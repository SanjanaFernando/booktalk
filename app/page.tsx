"use client";
import Sherlock from "../app/assests/sherlock.jpg";

import { useState, useRef, useEffect } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader";

// Message type
type Message = {
  id: string;
  role: "user" | "character";
  text: string;
  isStreaming?: boolean;
};

interface ISpeechRecognition extends EventTarget {
  lang: string;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: ISpeechRecognitionEvent) => void) | null;
  onerror: ((event: ISpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

interface ISpeechRecognitionEvent {
  results: ISpeechRecognitionResultArray;
}

interface ISpeechRecognitionResultArray {
  [index: number]: ISpeechRecognitionResult;
  length: number;
}

interface ISpeechRecognitionResult {
  [index: number]: ISpeechRecognitionAlternative;
  isFinal: boolean;
  length: number;
}

interface ISpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface ISpeechRecognitionErrorEvent {
  error: string;
}

declare global {
  interface Window {
    SpeechRecognition: { new (): ISpeechRecognition };
    webkitSpeechRecognition: { new (): ISpeechRecognition };
  }
}

// --- Character Display Component (Using Images) ---

interface CharacterDisplayProps {
  characterId: string;
  name: string;
  imageUrl: string;
  isSpeaking: boolean;
}

const CharacterDisplay: React.FC<CharacterDisplayProps> = ({
  characterId,
  name,
  imageUrl,
  isSpeaking,
}) => {
  return (
    <div className="flex flex-col items-center justify-center p-4 bg-white rounded-xl shadow-2xl mb-4 w-full max-w-sm">
      <div className="relative w-32 h-32 rounded-full overflow-hidden border-4 border-gray-200 shadow-lg">
        {/* Character Image */}
        <img
          src={imageUrl}
          alt={`${name} Portrait`}
          className="w-full h-full object-cover"
          onError={(e) => {
            // Fallback if the placeholder image fails to load
            (
              e.target as HTMLImageElement
            ).src = `https://placehold.co/150x150/CCCCCC/000000?text=${name}`;
          }}
        />

        {/* Mouth Overlay for Lip Sync Animation */}
        <div
          id="mouth-overlay"
          className={`
            absolute left-1/2 -translate-x-1/2 top-[65%]
            w-[25%] h-[8%] rounded-sm
            ${
              isSpeaking
                ? "bg-red-500 animate-mouth-img opacity-80"
                : "bg-transparent"
            }
            transition-all duration-100
          `}
        ></div>
      </div>

      <h2 className="mt-3 text-2xl font-extrabold text-gray-800">{name}</h2>
      <p
        className={`text-sm ${
          isSpeaking ? "text-blue-600 font-semibold" : "text-gray-500"
        }`}
      >
        {isSpeaking ? "🗣️ Speaking..." : "...Awaiting Query..."}
      </p>
    </div>
  );
};

// --- Main Chat Component ---

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [characterId, setCharacterId] = useState<string>("sherlock");
  const [isSpeaking, setIsSpeaking] = useState(false);

  const characters = [
    { id: "sherlock", name: "Sherlock Holmes" },
    { id: "harrypotter", name: "Harry Potter" },
    { id: "snape", name: "Professor Snape" },
    { id: "dumbledore", name: "Albus Dumbledore" },
  ];

  // --- Voice Input ---
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const [isListening, setIsListening] = useState(false);

  useEffect(() => {
    const SpeechRecognitionClass =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      recognitionRef.current = null;
      return;
    }

    const recognition = new SpeechRecognitionClass();
    recognition.lang = "en-US";
    recognition.interimResults = false;

    recognition.onresult = (event: ISpeechRecognitionEvent) => {
      try {
        const alternative = event.results[0][0];
        const spokenText = alternative?.transcript ?? "";
        setInput(spokenText);
        if (event.results[0].isFinal) send(spokenText);
      } catch (e) {
        console.error("Error handling speech result:", e);
      }
    };

    recognition.onerror = (e: ISpeechRecognitionErrorEvent) => {
      console.error("Speech recognition error:", e?.error);
      setIsListening(false);
    };

    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;

    return () => {
      try {
        recognition.stop();
      } catch {}
      recognitionRef.current = null;
    };
  }, []);

  const startVoiceInput = () => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      alert("Speech Recognition not supported in this browser.");
      return;
    }
    if (isListening) {
      recognition.stop();
      setIsListening(false);
      return;
    }
    recognition.start();
    setIsListening(true);
  };

  // --- Three.js Avatar Setup ---
  const mountRef = useRef<HTMLDivElement>(null);
  const avatarRef = useRef<THREE.Group | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelLoading, setModelLoading] = useState<boolean>(false);
  const [morphTargets, setMorphTargets] = useState<string[]>([]);
  const morphMeshesRef = useRef<any[]>([]);
  const jawBoneRef = useRef<any | null>(null);
  const headBoneRef = useRef<any | null>(null);
  const isSpeakingRef = useRef(false);
  const spineBonesRef = useRef<any[]>([]);
  const leftArmBonesRef = useRef<any[]>([]);
  const rightArmBonesRef = useRef<any[]>([]);
  // morph targets smoothing: target values map
  const morphTargetTargetsRef = useRef<Record<string, number>>({});
  const morphTargetCurrentRef = useRef<Record<string, number>>({});
  const currentJawOpenRef = useRef(0);
  const targetJawOpenRef = useRef(0);

  useEffect(() => {
    if (!mountRef.current) return;

    const width = mountRef.current.clientWidth || 400;
    const height = mountRef.current.clientHeight || 400;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    camera.position.set(0, 1.6, 2.8);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Append canvas hidden and fade it in for smooth model swaps
    if (mountRef.current) {
      renderer.domElement.style.opacity = "0";
      renderer.domElement.style.transition = "opacity 400ms ease";
      mountRef.current.appendChild(renderer.domElement);
      requestAnimationFrame(() => {
        renderer.domElement.style.opacity = "1";
      });
    }

    // Lights: ambient + directional for nice shading and shadows
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);

    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(5, 10, 7.5);
    dir.castShadow = true;
    dir.shadow.camera.near = 0.1;
    dir.shadow.camera.far = 50;
    dir.shadow.mapSize.width = 2048;
    dir.shadow.mapSize.height = 2048;
    scene.add(dir);

    const loader = new GLTFLoader();
    // Support both possible filenames for the selected character id
    const candidateUrls = [
      `/models/${characterId}.glb`,
      `/models/${characterId}.glb.glb`,
    ];
    setModelLoading(true);

    // Try each candidate URL until one is found and successfully loaded.
    let tried = 0;
    const tryNext = () => {
      if (tried >= candidateUrls.length) {
        setModelError(
          "Model file not found. Place your .glb at public/models/sherlock.glb"
        );
        setModelLoading(false);
        return;
      }
      const url = candidateUrls[tried++];

      fetch(url, { method: "HEAD" })
        .then((r) => {
          if (!r.ok) throw new Error(`Model not found (status ${r.status})`);
          loader.load(
            url,
            (gltf: GLTF) => {
              avatarRef.current = gltf.scene;

              // Enable shadows and collect morph target meshes
              // Also hide any meshes/bones that look like hands/fingers/thumbs
              morphMeshesRef.current = [];
              gltf.scene.traverse((obj: any) => {
                const name = (obj.name || "").toLowerCase();

                // If a mesh looks like a hand or finger, hide it so the avatar has no hands
                if (
                  obj.isMesh &&
                  (name.includes("hand") ||
                    name.includes("finger") ||
                    name.includes("thumb") ||
                    name.includes("palm"))
                ) {
                  obj.visible = false;
                  obj.castShadow = false;
                  obj.receiveShadow = false;
                  return; // skip further collection for hidden hand meshes
                }

                if (obj.isMesh) {
                  obj.castShadow = true;
                  obj.receiveShadow = true;
                  if (obj.morphTargetDictionary && obj.morphTargetInfluences) {
                    morphMeshesRef.current.push(obj);
                  }
                }

                // collect jaw/head/spine/arm bones if present (common names)
                if (name.includes("jaw") && !jawBoneRef.current)
                  jawBoneRef.current = obj;
                if (
                  (name.includes("head") || name.includes("neck")) &&
                  !headBoneRef.current
                )
                  headBoneRef.current = obj;
                if (
                  name.includes("spine") ||
                  name.includes("chest") ||
                  name.includes("hips")
                )
                  spineBonesRef.current.push(obj);

                // collect arm bones but avoid collecting hand/finger bones
                if (
                  name.includes("shoulder") ||
                  name.includes("upperarm") ||
                  name.includes("arm") ||
                  name.includes("clavicle")
                ) {
                  if (
                    name.includes("left") ||
                    name.endsWith("_l") ||
                    name.endsWith(".l")
                  )
                    leftArmBonesRef.current.push(obj);
                  else if (
                    name.includes("right") ||
                    name.endsWith("_r") ||
                    name.endsWith(".r")
                  )
                    rightArmBonesRef.current.push(obj);
                  else {
                    leftArmBonesRef.current.push(obj);
                    rightArmBonesRef.current.push(obj);
                  }
                }

                // If a bone looks like a hand/finger, hide it too (keep skeletal transforms but don't render children meshes)
                if (
                  (obj.type === "Bone" || obj.type === "Object3D") &&
                  (name.includes("hand") ||
                    name.includes("finger") ||
                    name.includes("thumb") ||
                    name.includes("palm"))
                ) {
                  obj.visible = false;
                }
              });

              // Compute bounding box and center/scale the model to fit the view
              const box = new THREE.Box3().setFromObject(gltf.scene);
              const size = new THREE.Vector3();
              box.getSize(size);
              const center = new THREE.Vector3();
              box.getCenter(center);

              // Move model so its center is at origin
              gltf.scene.position.x += -center.x;
              gltf.scene.position.y += -center.y;
              gltf.scene.position.z += -center.z;

              // Scale model to fit into a ~1.6m tall area
              const maxDim = Math.max(size.x, size.y, size.z);
              const desired = 1.6; // meters approx
              if (maxDim > 0) {
                const scale = desired / maxDim;
                gltf.scene.scale.setScalar(scale);
              }

              scene.add(gltf.scene);

              // Position camera to focus on the face/head if available, otherwise center of model
              const scaleFactor = gltf.scene.scale.x || 1;
              let focusPoint = new THREE.Vector3(0, 0, 0);
              if (headBoneRef.current) {
                headBoneRef.current.updateWorldMatrix(true, false);
                headBoneRef.current.getWorldPosition(focusPoint);
              } else {
                // use bbox center but shift downward so the camera frames the full body (show legs)
                focusPoint.copy(center);
                // decrease this multiplier to move the model up/down relative to the viewport.
                // Positive moves focus up (closer to head). Negative moves focus down (shows more legs).
                focusPoint.y -= size.y * 0.15; // adjust this value (0.05 - 0.25) to fine-tune framing
              }

              // Compute world size after scale
              const worldMax = Math.max(size.x, size.y, size.z) * scaleFactor;

              // Place camera in front of the face at a distance proportional to model size
              // Apply a zoom multiplier <1 to move camera closer (zoom in). Tweak this value to adjust framing.
              const zoomMultiplier = 0.6; // values <1 zoom in, >1 zoom out
              const camOffset = new THREE.Vector3(
                0,
                worldMax * 0.12 * zoomMultiplier,
                worldMax * 1.0 * zoomMultiplier
              );
              const camPos = new THREE.Vector3()
                .copy(focusPoint)
                .add(camOffset);
              camera.position.copy(camPos);
              camera.lookAt(focusPoint);

              // Gather morph target keys to expose in UI
              const keys = new Set<string>();
              for (const m of morphMeshesRef.current) {
                const dict = m.morphTargetDictionary as Record<string, number>;
                if (dict) {
                  for (const k of Object.keys(dict)) keys.add(k);
                }
              }
              const keyArray = Array.from(keys);
              setMorphTargets(keyArray);

              // Initialize influences to 0
              for (const m of morphMeshesRef.current) {
                if (m.morphTargetInfluences) {
                  for (let i = 0; i < m.morphTargetInfluences.length; i++)
                    m.morphTargetInfluences[i] = 0;
                }
              }

              setModelLoading(false);
            },
            undefined,
            (err) => {
              console.warn("GLTFLoader failed to load model:", err);
              // try the next possible filename
              tryNext();
            }
          );
        })
        .catch((err) => {
          console.warn(`Model file not found at ${url}:`, err);
          // try the next candidate
          tryNext();
        });
    };

    tryNext();

    const clock = new THREE.Clock();
    const animate = () => {
      const dt = clock.getDelta();

      // smooth morph targets toward target values
      for (const m of morphMeshesRef.current) {
        const dict = m.morphTargetDictionary as
          | Record<string, number>
          | undefined;
        const infl = m.morphTargetInfluences as number[] | undefined;
        if (!dict || !infl) continue;
        for (const [name, targetVal] of Object.entries(
          morphTargetTargetsRef.current
        )) {
          const idx = dict[name];
          if (typeof idx === "number") {
            const cur = infl[idx] ?? 0;
            const next = cur + (targetVal - cur) * Math.min(1, dt * 10);
            infl[idx] = next;
            morphTargetCurrentRef.current[name] = next;
          }
        }
      }

      // smooth jaw bone rotation toward targetJawOpenRef
      if (jawBoneRef.current) {
        const cur = currentJawOpenRef.current;
        const tgt = targetJawOpenRef.current;
        const next = cur + (tgt - cur) * Math.min(1, dt * 8);
        currentJawOpenRef.current = next;
        jawBoneRef.current.rotation.x = next * 0.45; // scale to reasonable rotation
      }

      // simple speaking head nod animation
      if (headBoneRef.current && isSpeakingRef.current) {
        const t = performance.now() / 1000;
        headBoneRef.current.rotation.x = Math.sin(t * 2) * 0.02;
      }

      requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      if (!mountRef.current) return;
      const w = mountRef.current.clientWidth || 400;
      const h = mountRef.current.clientHeight || 400;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);

      // Fade out canvas before removing to make swaps smooth
      try {
        const dom = renderer.domElement;
        if (dom && dom.parentElement) {
          dom.style.transition = "opacity 400ms ease";
          dom.style.opacity = "0";
          setTimeout(() => {
            try {
              dom.parentElement?.removeChild(dom);
            } catch {}
            try {
              renderer.dispose();
            } catch {}
          }, 420);
        } else {
          try {
            renderer.dispose();
          } catch {}
        }
      } catch (e) {
        try {
          renderer.dispose();
        } catch {}
      }
    };
  }, [characterId]);

  // Helper: set morph target by name across all morph meshes
  const setMorphValue = (name: string, value: number) => {
    for (const m of morphMeshesRef.current) {
      const dict = m.morphTargetDictionary as
        | Record<string, number>
        | undefined;
      const infl = m.morphTargetInfluences as number[] | undefined;
      if (dict && infl) {
        const idx = dict[name];
        if (typeof idx === "number") {
          infl[idx] = value;
        }
      }
    }
  };

  // --- Mouth Animation ---
  const moveMouth = (open: boolean) => {
    const jaw = avatarRef.current?.getObjectByName("Jaw");
    if (jaw) jaw.rotation.x = open ? 0.25 : 0;
  };

  // --- TTS with mouth sync ---
  // Viseme / lip-sync helpers
  const visemeRAFRef = useRef<number | null>(null);

  const estimateSpeechDuration = (text: string, wpm = 160) => {
    const words = text.trim().split(/\s+/).filter(Boolean).length || 1;
    const minutes = words / wpm;
    return Math.max(0.5, minutes * 60); // at least 0.5s
  };

  const estimateSyllables = (text: string) => {
    const matches = text.toLowerCase().match(/[aeiouy]+/g);
    if (matches && matches.length > 0) return matches.length;
    // fallback: roughly 1.5 syllables per word
    const words = text.trim().split(/\s+/).filter(Boolean).length || 1;
    return Math.max(1, Math.round(words * 1.5));
  };

  type Viseme = "open" | "closed" | "round" | "wide" | "neutral";

  const pickVisemeForChunk = (chunk: string): Viseme => {
    const c = chunk.toLowerCase();
    if (/[ouOA]/.test(c)) return "round";
    if (/[ieaEI]/.test(c)) return "wide";
    if (/[bmpfvwMBPFV]/.test(c)) return "closed";
    if (/[tdkgTDKG]/.test(c)) return "closed";
    if (/[sSshSH]/.test(c)) return "wide";
    // default
    return "open";
  };

  const generateVisemeSequence = (text: string, totalDuration: number) => {
    const syllables = estimateSyllables(text);
    const chunkSize = Math.max(1, Math.ceil(text.length / syllables));
    const seq: { time: number; viseme: Viseme }[] = [];
    let t = 0;
    const per = totalDuration / syllables;
    for (let i = 0; i < syllables; i++) {
      const start = i * chunkSize;
      const chunk = text.slice(start, start + chunkSize) || text.slice(-1);
      const vis = pickVisemeForChunk(chunk);
      seq.push({ time: t, viseme: vis });
      t += per;
    }
    return seq;
  };

  const applyViseme = (viseme: Viseme) => {
    // Instead of setting influences instantly, set target values for smoothing in the render loop
    const mouthOpenKeys = [
      "MouthOpen",
      "mouthOpen",
      "jawOpen",
      "JawOpen",
      "open",
      "Mouth_Open",
    ];
    const smileKeys = ["Smile", "smile", "mouthSmile", "smile_big"];

    const mouthValue =
      viseme === "closed"
        ? 0
        : viseme === "wide"
        ? 0.6
        : viseme === "open"
        ? 0.9
        : viseme === "round"
        ? 0.8
        : 0;
    const smileValue = viseme === "wide" ? 0.4 : 0;

    // Apply to morph target target map
    for (const k of mouthOpenKeys)
      morphTargetTargetsRef.current[k] = mouthValue;
    for (const k of smileKeys) morphTargetTargetsRef.current[k] = smileValue;

    // If no morph targets exist, use jaw bone fallback: set target open amount
    if (
      (!morphMeshesRef.current || morphMeshesRef.current.length === 0) &&
      jawBoneRef.current
    ) {
      targetJawOpenRef.current = mouthValue; // will be interpolated in animation loop
    }
  };

  const stopVisemePlayback = () => {
    if (visemeRAFRef.current) {
      cancelAnimationFrame(visemeRAFRef.current);
      visemeRAFRef.current = null;
    }
    // reset mouth
    applyViseme("neutral");
  };

  const startVisemePlayback = (seq: { time: number; viseme: Viseme }[]) => {
    stopVisemePlayback();
    const start = performance.now();
    let idx = 0;

    const step = () => {
      const elapsed = (performance.now() - start) / 1000;
      while (idx < seq.length && elapsed >= seq[idx].time) {
        applyViseme(seq[idx].viseme);
        idx++;
      }
      if (idx < seq.length) visemeRAFRef.current = requestAnimationFrame(step);
      else
        visemeRAFRef.current = requestAnimationFrame(() =>
          applyViseme("neutral")
        );
    };

    visemeRAFRef.current = requestAnimationFrame(step);
  };

  const speakText = (text: string) => {
    if (!text) return;

    // Optional: map punctuation/keywords to simple facial expressions
    const expression = (() => {
      if (text.includes("!")) return "happy";
      if (text.includes("?")) return "surprised";
      if (text.includes("...")) return "thinking";
      return "neutral";
    })();

    // Estimate duration and viseme schedule
    const estimated = estimateSpeechDuration(text, 160);
    const seq = generateVisemeSequence(text, estimated);

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 1;
    utterance.pitch = 1;

    utterance.onstart = () => {
      // apply simple expression morphs if available
      if (avatarRef.current) {
        avatarRef.current.traverse((obj: any) => {
          if (obj.morphTargetDictionary && obj.morphTargetInfluences) {
            const dict = obj.morphTargetDictionary as Record<string, number>;
            const infl = obj.morphTargetInfluences as number[];
            if (expression === "happy") {
              const s = dict["Smile"] ?? dict["smile"] ?? dict["mouthSmile"];
              if (typeof s === "number") infl[s] = 1;
            } else if (expression === "thinking") {
              // subtle raise brows or similar if available
              const b = dict["BrowsUp"] ?? dict["browsUp"];
              if (typeof b === "number") infl[b] = 0.6;
            }
          }
        });
      }
      startVisemePlayback(seq);
    };

    utterance.onend = () => {
      stopVisemePlayback();
      // clear any expression morphs
      if (avatarRef.current) {
        avatarRef.current.traverse((obj: any) => {
          if (obj.morphTargetDictionary && obj.morphTargetInfluences) {
            const dict = obj.morphTargetDictionary as Record<string, number>;
            const infl = obj.morphTargetInfluences as number[];
            for (const k of [
              "Smile",
              "smile",
              "mouthSmile",
              "BrowsUp",
              "browsUp",
            ]) {
              const idx = dict[k];
              if (typeof idx === "number") infl[idx] = 0;
            }
          }
        });
      }
    };

    speechSynthesis.speak(utterance);
  };

  // --- Send with retry/backoff and robust server-error parsing ---
  const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

  const parseServerError = async (res: Response) => {
    try {
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const j = await res.json();
        let msg = j.error || j.message || JSON.stringify(j);
        // some servers put a stringified JSON in detail
        if (j.detail) {
          try {
            const d =
              typeof j.detail === "string" ? JSON.parse(j.detail) : j.detail;
            msg = d.error?.message || d.message || msg;
          } catch (e) {
            // ignore parse error, keep original
          }
        }
        return String(msg);
      }
      const text = await res.text();
      try {
        const parsed = JSON.parse(text);
        let msg = parsed.error || parsed.message || text;
        if (parsed.detail) {
          try {
            const d =
              typeof parsed.detail === "string"
                ? JSON.parse(parsed.detail)
                : parsed.detail;
            msg = d.error?.message || d.message || msg;
          } catch {}
        }
        return String(msg);
      } catch {
        return text;
      }
    } catch (e) {
      return String(e);
    }
  };

  const send = async (overrideInput?: string) => {
    const messageToSend = overrideInput ?? input;
    if (!messageToSend) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      text: messageToSend,
    };
    const charMsgId = (Date.now() + 1).toString();

    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: charMsgId, role: "character", text: "", isStreaming: true },
    ]);
    setInput("");
    setLoading(true);

    const history = messages.map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.text,
    }));

    const maxRetries = 3;
    let attempt = 0;
    const delays = [1000, 2000, 4000];

    while (attempt <= maxRetries) {
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: messageToSend,
            characterId,
            history,
            speech: false,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const generatedText = data?.text || "Error: No text in response.";
          setMessages((prev) =>
            prev.map((m) =>
              m.id === charMsgId
                ? { ...m, text: generatedText, isStreaming: false }
                : m
            )
          );
          speakText(generatedText);
          setLoading(false);
          return;
        }

        const serverMsg = await parseServerError(res);

        // If model is overloaded (503) we retry with backoff
        if (res.status === 503 && attempt < maxRetries) {
          const nextAttempt = attempt + 1;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === charMsgId
                ? {
                    ...m,
                    text: `Server busy — retrying (${nextAttempt}/${maxRetries})...`,
                    isStreaming: true,
                  }
                : m
            )
          );
          await sleep(delays[attempt] ?? 2000);
          attempt = nextAttempt;
          continue; // retry
        }

        // Non-retriable or out of retries: surface error
        setMessages((prev) =>
          prev.map((m) =>
            m.id === charMsgId
              ? { ...m, text: `Server error: ${serverMsg}`, isStreaming: false }
              : m
          )
        );
        // Provide a spoken fallback so the experience isn't silent
        speakText(
          "Sorry, I'm having trouble right now. Please try again in a moment."
        );
        setLoading(false);
        return;
      } catch (err) {
        console.error("Network/send error:", err);
        if (attempt < maxRetries) {
          const nextAttempt = attempt + 1;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === charMsgId
                ? {
                    ...m,
                    text: `Network error — retrying (${nextAttempt}/${maxRetries})...`,
                    isStreaming: true,
                  }
                : m
            )
          );
          await sleep(delays[attempt] ?? 2000);
          attempt = nextAttempt;
          continue;
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === charMsgId
              ? { ...m, text: "Error contacting server.", isStreaming: false }
              : m
          )
        );
        speakText(
          "Sorry, I couldn't reach the server. Please check your connection and try again."
        );
        setLoading(false);
        return;
      }
    }

    // if we exit loop unexpectedly
    setMessages((prev) =>
      prev.map((m) =>
        m.id === charMsgId
          ? { ...m, text: "Unexpected error.", isStreaming: false }
          : m
      )
    );
    setLoading(false);
  };

  return (
    <main
      style={{
        width: "100vw",
        height: "100vh",
        margin: 0,
        padding: 0,
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Large Avatar area (full screen) */}
      <div
        ref={mountRef}
        style={{
          width: "100%",
          height: "100%",
          position: "absolute",
          inset: 0,
        }}
      />

      {/* Small overlay UI for chat and controls prioritized to character */}
      <div
        style={{
          position: "absolute",
          right: 20,
          bottom: 20,
          width: 360,
          maxHeight: "70vh",
          background: "rgba(1, 0, 0, 0.85)",
          borderRadius: 12,
          padding: 12,
          boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
          overflow: "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <strong>BookTalk</strong>
          <select
            value={characterId}
            onChange={(e) => {
              setCharacterId(e.target.value);
              setMessages([]);
              setInput("");
              setLoading(false);
            }}
            disabled={loading}
          >
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {modelLoading && (
          <div style={{ color: "#666" }}>Loading 3D model...</div>
        )}
        {modelError && <div style={{ color: "#b00" }}>{modelError}</div>}

        <div
          className="chat-container"
          style={{ background: "transparent", border: "none", padding: 0 }}
        >
          {messages.map((m) => (
            <div key={m.id} className={`message ${m.role}`}>
              <div className="messageInner">
                <strong className="messageLabel">
                  {m.role === "user"
                    ? "You"
                    : characters.find((c) => c.id === characterId)?.name ||
                      "Character"}
                </strong>
                <div>{m.text}</div>
              </div>
            </div>
          ))}
        </div>

        <div
          className="chat-controls"
          style={{ marginTop: 8, display: "flex", gap: 8 }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            disabled={loading}
            placeholder={`Talk to ${
              characters.find((c) => c.id === characterId)?.name ||
              "the character"
            }...`}
            style={{ flex: 1 }}
          />
          <button onClick={() => send()} disabled={loading || !input}>
            Send
          </button>
          <button onClick={startVoiceInput} disabled={loading}>
            🎤
          </button>
        </div>

        {/* Morph sliders (if any) */}
        {!modelLoading && !modelError && morphTargets.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <strong style={{ display: "block", marginBottom: 6 }}>
              Expressions
            </strong>
            {morphTargets.map((name) => (
              <label
                key={name}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  marginBottom: 6,
                }}
              >
                <span style={{ minWidth: 100 }}>{name}</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  defaultValue={0}
                  onChange={(e) =>
                    setMorphValue(
                      name,
                      Number((e.target as HTMLInputElement).value)
                    )
                  }
                />
              </label>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
