import styles from "./StartingScreen.module.css";

export default function StartingScreen() {
  return (
    <div className={styles.container}>
      <div className={styles.inner}>
        <div className={styles.spinner} />
        <p className={styles.text}>正在启动服务...</p>
      </div>
    </div>
  );
}
