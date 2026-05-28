import { useRef, useEffect, useState, useCallback } from 'react';
import { Camera, X, RotateCcw, ZapOff, Video, Mic, Square } from 'lucide-react';

interface Props {
  mode: 'photo' | 'video' | 'audio';
  onCapture: (dataUrl: string, file: File) => void;
  onClose: () => void;
}

export default function LiveMediaCapture({ mode, onCapture, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);

  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const startTimeRef = useRef(0);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  const startStream = useCallback(async (camMode: 'environment' | 'user') => {
    stopStream();
    setReady(false);
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: mode !== 'audio' ? { facingMode: camMode, width: { ideal: 1280 }, height: { ideal: 720 } } : false,
        audio: mode !== 'photo', // need audio for video/audio mode
      });
      streamRef.current = stream;
      if (videoRef.current && mode !== 'audio') {
        videoRef.current.srcObject = stream;
      } else if (mode === 'audio') {
        setReady(true);
      }
    } catch {
      setError(`Camera/Microphone access was denied. Please allow permissions in your settings.`);
    }
  }, [mode, stopStream]);

  useEffect(() => {
    startStream('environment');
    return () => {
      stopStream();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [startStream, stopStream]);

  const flip = () => {
    if (mode === 'audio') return;
    const next = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(next);
    startStream(next);
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video || !ready || !streamRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    canvas.toBlob(blob => {
      if (blob) onCapture(dataUrl, new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.9);
  };

  const startRecording = () => {
    if (!streamRef.current) return;
    chunksRef.current = [];
    const mime = mode === 'video' 
      ? (['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(t => MediaRecorder.isTypeSupported(t)) || '') 
      : (['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(t => MediaRecorder.isTypeSupported(t)) || '');
      
    try {
      const recorder = new MediaRecorder(streamRef.current, mime ? { mimeType: mime } : {});
      recorderRef.current = recorder;
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mime || (mode === 'video' ? 'video/webm' : 'audio/webm') });
        const ext = mode === 'video' ? 'webm' : 'webm';
        const file = new File([blob], `${mode}_${Date.now()}.${ext}`, { type: blob.type });
        const dataUrl = URL.createObjectURL(blob);
        onCapture(dataUrl, file);
      };
      recorder.start(200);
      setRecording(true);
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => setDuration(Date.now() - startTimeRef.current), 200);
    } catch (err: any) {
      setError('MediaRecorder failed to start. Format might not be supported.');
    }
  };

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
      if (timerRef.current) clearInterval(timerRef.current);
      setRecording(false);
    }
  };

  const handleClose = () => { stopStream(); onClose(); };

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 bg-black/70 safe-top">
        <span className="text-white font-semibold text-sm tracking-wide capitalize">
          {mode === 'photo' ? 'Take Photo' : `Record ${mode}`}
        </span>
        <button onClick={handleClose} className="text-white hover:text-gray-300 p-1"><X size={22} /></button>
      </div>

      <div className="flex-1 relative overflow-hidden bg-black flex flex-col items-center justify-center">
        {error ? (
          <div className="flex flex-col items-center gap-4 p-8 text-center">
            <ZapOff size={40} className="text-gray-400" />
            <p className="text-white text-sm">{error}</p>
          </div>
        ) : mode === 'audio' ? (
          <div className="flex flex-col items-center gap-6">
            <div className={`w-32 h-32 rounded-full flex items-center justify-center border-4 transition-all duration-300 ${recording ? 'bg-red-500/20 border-red-500 animate-pulse' : 'bg-gray-800 border-gray-600'}`}>
              <Mic size={48} className={recording ? 'text-red-500' : 'text-gray-400'} />
            </div>
            {recording && <div className="text-5xl font-mono font-bold text-white tracking-wider">{formatTime(duration)}</div>}
          </div>
        ) : (
          <>
            <video ref={videoRef} autoPlay playsInline muted={true} onCanPlay={() => setReady(true)} className="w-full h-full object-cover" />
            {!ready && <div className="absolute flex items-center justify-center"><div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" /></div>}
            {recording && (
              <div className="absolute top-4 right-4 bg-black/60 backdrop-blur-md rounded-full px-4 py-1.5 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-white text-lg font-mono font-bold tracking-widest">{formatTime(duration)}</span>
              </div>
            )}
            {ready && !recording && mode === 'photo' && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="w-64 h-64 relative opacity-60">
                  <span className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-white" />
                  <span className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-white" />
                  <span className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-white" />
                  <span className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-white" />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex items-center justify-between px-10 py-7 bg-black/70 safe-bottom">
        {mode !== 'audio' ? (
          <button onClick={flip} disabled={!!error || recording} className="text-white disabled:opacity-30 p-2"><RotateCcw size={26} /></button>
        ) : <div className="w-10"></div>}

        {mode === 'photo' ? (
          <button onClick={capturePhoto} disabled={!ready || !!error} className="w-[68px] h-[68px] rounded-full bg-white border-4 border-gray-400 disabled:opacity-30 active:scale-95 transition-transform" />
        ) : recording ? (
          <button onClick={stopRecording} className="w-[68px] h-[68px] rounded-full bg-transparent border-4 border-white flex items-center justify-center active:scale-95 transition-transform">
            <Square fill="red" stroke="red" size={24} className="rounded-sm" />
          </button>
        ) : (
          <button onClick={startRecording} disabled={!ready || !!error} className="w-[68px] h-[68px] rounded-full bg-red-600 border-4 border-white disabled:opacity-30 active:scale-95 transition-transform" />
        )}

        <div className="w-[42px]" />
      </div>
    </div>
  );
}
