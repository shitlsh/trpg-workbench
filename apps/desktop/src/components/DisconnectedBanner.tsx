import styles from "./DisconnectedBanner.module.css";

export default function DisconnectedBanner() {
  return (
    <div className={styles.banner}>
      后端服务已断开，正在尝试重新连接...
    </div>
  );
}
