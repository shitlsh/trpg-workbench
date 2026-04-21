import styles from "./FailedScreen.module.css";
import { useBackendStore } from "../stores/backendStore";

interface Props {
  onRetry: () => void;
}

export default function FailedScreen({ onRetry }: Props) {
  const { error } = useBackendStore();
  return (
    <div className={styles.container}>
      <div className={styles.inner}>
        <h2 className={styles.title}>服务启动失败</h2>
        <p className={styles.message}>{error ?? "后端服务无法启动，请检查环境配置。"}</p>
        <button className={styles.retryBtn} onClick={onRetry}>重试</button>
      </div>
    </div>
  );
}
