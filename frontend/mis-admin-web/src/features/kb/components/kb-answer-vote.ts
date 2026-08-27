import type { KbFeedbackForm, KbQaFeedback } from '../types';

/** 点赞 / 吐槽（映射到会话级四维评分，供运营看板折算好评/差评）。 */
export type AnswerVote = 'up' | 'down';

/** 点赞：准确性/有用性满分，跑题与引用错误打到最低。 */
export const LIKE_FEEDBACK: KbFeedbackForm = {
  accuracy: 5,
  helpful: 5,
  offtopic: 1,
  citeError: 1,
};

/** 吐槽：准确性/有用性最低，跑题打高（运营看板记为差评）。 */
export const DISLIKE_FEEDBACK: KbFeedbackForm = {
  accuracy: 1,
  helpful: 1,
  offtopic: 5,
  citeError: 1,
};

/**
 * 把已落库的四维评分折回点赞/吐槽。
 *
 * <p>口径与运营看板一致：accuracy/helpful 非空均值 ≥4 好评、≤2 差评；
 * 旧的四星中评无法对应到按钮，视为未投。
 */
export function voteFromFeedback(fb: KbQaFeedback | null | undefined): AnswerVote | null {
  if (fb == null) return null;
  const scores = [fb.accuracy, fb.helpful].filter((n): n is number => n != null);
  if (scores.length === 0) return null;
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  if (avg >= 4) return 'up';
  if (avg <= 2) return 'down';
  return null;
}
