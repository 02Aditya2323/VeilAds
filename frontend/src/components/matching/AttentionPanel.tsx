"use client";

import { Clock, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CampaignInfo } from "@/lib/contract";
import { demoLog } from "@/lib/demoLog";
import { getMediaKind, normalizeAdLink } from "@/lib/media";

const UI_ATTENTION_SECONDS = 6;

export function AttentionPanel({
  campaign,
  disabled,
  onSubmit,
  submitted,
}: {
  campaign: CampaignInfo;
  disabled?: boolean;
  onSubmit: (seconds: number) => Promise<void>;
  submitted?: boolean;
}) {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const submittedRef = useRef(false);
  const mediaUrl = useMemo(() => normalizeAdLink(campaign.adURI), [campaign.adURI]);
  const mediaKind = useMemo(() => getMediaKind(mediaUrl), [mediaUrl]);

  useEffect(() => {
    submittedRef.current = Boolean(submitted);
  }, [submitted]);

  useEffect(() => {
    if (disabled || submitted || running) return;
    if (mediaKind === "video") {
      const video = videoRef.current;
      if (!video) return;
      video.muted = true;
      video
        .play()
        .then(() => {
          setAutoplayBlocked(false);
          demoLog("attention", "video autoplay started", { campaignId: campaign.id, mediaUrl });
        })
        .catch((err) => {
          setAutoplayBlocked(true);
          demoLog("attention", "video autoplay blocked", { error: err instanceof Error ? err.message : String(err) });
        });
      return;
    }
    setRunning(true);
    demoLog("attention", "non-video creative timer started", { campaignId: campaign.id, mediaUrl });
  }, [campaign.id, disabled, mediaKind, mediaUrl, running, submitted]);

  useEffect(() => {
    if (!running || submittedRef.current) return;
    const interval = window.setInterval(() => {
      const videoIsActuallyPlaying =
        mediaKind !== "video" ||
        (videoRef.current !== null && !videoRef.current.paused && !videoRef.current.ended);
      if (document.visibilityState === "visible" && videoIsActuallyPlaying) {
        setElapsed((current) => current + 1);
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [mediaKind, running]);

  useEffect(() => {
    if (disabled || submitting || submittedRef.current || elapsed < UI_ATTENTION_SECONDS) return;
    submittedRef.current = true;
    void submitMeasuredAttention();
  }, [disabled, elapsed, submitting]);

  async function submitMeasuredAttention() {
    setSubmitting(true);
    try {
      setRunning(false);
      demoLog("attention", "submitting measured attention", { seconds: elapsed });
      await onSubmit(elapsed);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="panel attention-panel">
      <div className="toolbar" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <h2>Winning Ad</h2>
          <p className="card-meta">Campaign #{campaign.id.toString()} is playing from its public IPFS URI.</p>
        </div>
        <span className="badge teal">
          <Clock size={14} /> {elapsed}s
        </span>
      </div>

      <div className="media-frame">
        {mediaKind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mediaUrl} alt="Winning campaign creative" />
        ) : mediaKind === "video" ? (
          <video
            ref={videoRef}
            src={mediaUrl}
            autoPlay
            controls
            muted
            playsInline
            onPlay={() => {
              setRunning(true);
              demoLog("attention", "video play event", { campaignId: campaign.id });
            }}
            onPause={() => {
              setRunning(false);
              demoLog("attention", "video pause event", { elapsed });
            }}
            onEnded={() => {
              setRunning(false);
              demoLog("attention", "video ended", { elapsed });
            }}
          />
        ) : (
          <iframe src={mediaUrl} title="Winning campaign creative" />
        )}
      </div>

      <div className="attention-status">
        <span className={elapsed >= UI_ATTENTION_SECONDS ? "badge teal" : "badge amber"}>
          {submitting ? <Loader2 size={14} /> : <Clock size={14} />}
          Auto attention: {Math.min(elapsed, UI_ATTENTION_SECONDS)} / {UI_ATTENTION_SECONDS}s
        </span>
        {autoplayBlocked ? (
          <span className="badge amber">Browser blocked autoplay. Press play on the video.</span>
        ) : null}
        {submitted || submitting ? <span className="badge teal">Attention sent on-chain</span> : null}
      </div>
    </div>
  );
}
