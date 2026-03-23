import { useEffect, useRef } from "react";

const THRESHOLD_PX = 72;

/**
 * 仅在用户接近底部时自动滚到底，避免回看历史时被强行拉走。
 */
export function useChatScroll(messages, tools, logs, sending, banner) {
  const elRef = useRef(null);
  const stickBottomRef = useRef(true);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const onScroll = () => {
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickBottomRef.current = gap < THRESHOLD_PX;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = elRef.current;
    if (!el || !stickBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, tools, logs, sending, banner]);

  return elRef;
}
