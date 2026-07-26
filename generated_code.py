import streamlit as st
import plotly.graph_objects as go
import random

# 1. ページ構成（スマホ閲覧を最優先とする設定）
st.set_page_config(
    page_title="EFIS Engine Monitor",
    page_icon="✈️",
    layout="centered",
    initial_sidebar_state="collapsed"
)

# 2. スマホ対応カスタムCSS（旅客機のグラスコックピット・EICASを模したネオンカラー＆ダークテーマ）
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap');

/* 全体のダーク化とフォント設定 */
html, body, [data-testid="stAppViewContainer"], [data-testid="stHeader"] {
    background-color: #050811 !important;
    color: #00FF66 !important;
    font-family: 'Share Tech Mono', monospace !important;
}

/* メインコンテナのマージン調整 */
.block-container {
    padding-top: 1.5rem !important;
    padding-bottom: 1.5rem !important;
    padding-left: 0.8rem !important;
    padding-right: 0.8rem !important;
    max-width: 480px !important; /* スマホ幅に制限 */
    margin: auto;
}

/* 入力エリア（アコーディオン）のデザイン */
[data-testid="stExpander"] {
    background-color: #0B111E !important;
    border: 1px solid #1c2e4a !important;
    border-radius: 6px !important;
}
[data-testid="stExpander"] details summary {
    color: #00E5FF !important;
    font-weight: bold;
}

/* スライダー・入力コンポーネントのラベル */
div[data-testid="stWidgetLabel"] p {
    color: #00E5FF !important;
    font-size: 0.9rem !important;
}

/* タイトルヘッダー */
.cockpit-title {
    text-align: center;
    color: #00E5FF;
    font-size: 1.6rem;
    font-weight: bold;
    text-shadow: 0 0 10px rgba(0, 229, 255, 0.6);
    margin-bottom: 5px;
    letter-spacing: 2px;
}
.cockpit-subtitle {
    text-align: center;
    color: #5d7a96;
    font-size: 0.75rem;
    margin-bottom: 15px;
    letter-spacing: 1px;
}

/* 計器盤の外枠（ベゼル風） */
.instrument-panel {
    background-color: #010307;
    border: 2px solid #233347;
    border-radius: 12px;
    padding: 12px;
    box-shadow: inset 0 0 20px rgba(0,0,0,0.9), 0 4px 10px rgba(0,0,0,0.5);
    margin-top: 10px;
}

/* プロット枠の背景透過 */
.js-plotly-plot .plotly .main-svg {
    background: transparent !important;
}
</style>
""", unsafe_allow_html=True)

# アプリヘッダー表示
st.markdown('<div class="cockpit-title">EICAS ENGINE MONITOR</div>', unsafe_allow_html=True)
st.markdown('<div class="cockpit-subtitle">ELECTRONIC INSTRUMENT SYSTEM</div>', unsafe_allow_html=True)

# 3. エンジン諸元入力 (Expanderでスマホ画面を圧迫しないよう配慮)
with st.expander("⚙️ ENGINE SPECIFICATIONS (諸元入力)", expanded=False):
    col1, col2 = st.columns(2)
    with col1:
        rated_power = st.number_input("定格最大出力 (Rated) [PS]", min_value=10.0, max_value=5000.0, value=280.0, step=10.0)
        rated_rpm = st.number_input("定格回転数 (Rated) [rpm]", min_value=500, max_value=20000, value=2500, step=100)
    with col2:
        max_power = st.number_input("最大出力 (Max) [PS]", min_value=10.0, max_value=6000.0, value=320.0, step=10.0)
        max_rpm = st.number_input("最大回転数 (Max) [rpm]", min_value=500, max_value=25000, value=3000, step=100)
        
    fuel_type = st.selectbox(
        "燃料の種類 (Fuel Type)",
        ["ガソリン (Gasoline)", "軽油 (Diesel)", "A重油 (Heavy Oil)", "ジェット燃料 (Jet-A)"],
        index=1
    )

# 4. コックピット操作（現在のエンジン運転状態のコントロール）
with st.expander("🕹️ COCKPIT CONTROLS (運転シミュレート)", expanded=True):
    current_throttle = st.slider("THROTTLE (スロットル開度) [%]", min_value=0, max_value=110, value=75, step=1)
    current_rpm = st.slider("ENG SPEED (実回転数) [rpm]", min_value=0, max_value=int(max_rpm * 1.15), value=int(rated_rpm * 0.88), step=50)

# --- 燃料特性データベース ---
fuel_db = {
    "ガソリン (Gasoline)": {"density": 0.74, "base_sfc": 210, "label": "GASOLINE"},
    "軽油 (Diesel)": {"density": 0.84, "base_sfc": 165, "label": "DIESEL"},
    "A重油 (Heavy Oil)": {"density": 0.89, "base_sfc": 160, "label": "HEAVY OIL"},
    "ジェット燃料 (Jet-A)": {"density": 0.80, "base_sfc": 185, "label": "JET-A"}
}

fuel_info = fuel_db[fuel_type]
density = fuel_info["density"]
base_sfc = fuel_info["base_sfc"]

# --- 推定燃料消費率＆出力計算ロジック ---
L = current_throttle / 100.0  # 負荷率

if current_rpm == 0 or L == 0:
    current_power = 0.0
    calc_sfc = 0.0
else:
    # 1. 現在の出力 (PS) を回転数特性曲線(2次曲線)と負荷から動的算出
    rpm_ratio = current_rpm / rated_rpm
    power_curve = rpm_ratio * (2.0 - rpm_ratio)  # 定格回転数付近で最大効率となる設計
    current_power = max_power * L * max(0.0, min(1.15, power_curve))
    
    # 2. 推定燃料消費率 (SFC) [g/PS・h] の算出
    # 部分負荷（L=0.7〜0.85）や定格回転数の80%付近で最良効率となり、そこから外れるとSFCが悪化する実用的なエンジン特性モデル
    sfc_load_factor = 1.0 + 0.35 * (0.80 - L)**2 if L < 0.80 else 1.0 + 0.15 * (L - 0.80)**2
    sfc_rpm_factor = 1.0 + 0.25 * (rpm_ratio - 0.82)**2
    calc_sfc = base_sfc * sfc_load_factor * sfc_rpm_factor

# 燃料流量 (Fuel Flow: FF) の算出
# SFC [g/PS・h] * Power [PS] / 1000 = [kg/h]
fuel_flow_kgh = (current_power * calc_sfc) / 1000.0 if current_power > 0 else 0.0
fuel_flow_lh = fuel_flow_kgh / density if density > 0 else 0.0

# 排気ガス温度 (EGT) 推定 [°C] （スロットルと回転数に依存、航空計器で重要な指標）
if current_rpm == 0:
    egt = 25.0
else:
    egt = 120.0 + 580.0 * (0.35 * (current_rpm / max_rpm) + 0.65 * L)
    egt += random.uniform(-1.5, 1.5)  # アナログ感を出すための微小なゆらぎ

# --- 旅客機計器（EICAS）描画ヘルパー関数 ---
def make_eicas_gauge(value, min_val, max_val, title, unit, color="#00FF66", warning=None, danger=None, format_str=".1f"):
    """Plotlyを使用して円形デジタル計器(EICAS風)を構築"""
    steps = [{'range': [min_val, max_val], 'color': "rgba(255,255,255,0.02)"}]
    if warning and danger:
        steps = [
            {'range': [min_val, warning], 'color': "rgba(0, 255, 102, 0.04)"},
            {'range': [warning, danger], 'color': "rgba(255, 150, 0, 0.08)"},
            {'range': [danger, max_val], 'color': "rgba(255, 0, 0, 0.12)"}
        ]
        
    fig = go.Figure(go.Indicator(
        mode="gauge+number",
        value=value,
        domain={'x': [0, 1], 'y': [0, 1]},
        title={'text': f"<span style='font-size:0.85em;color:#00E5FF;font-weight:bold;'>{title}</span><br><span style='font-size:0.65em;color:#5d7a96;'>{unit}</span>", 'font': {'family': 'Share Tech Mono'}},
        gauge={
            'axis': {'range': [min_val, max_val], 'tickwidth': 1, 'tickcolor': '#233347', 'tickfont': {'color': '#5d7a96', 'size': 8}},
            'bar': {'color': color, 'thickness': 0.22},
            'bgcolor': "rgba(0,0,0,0)",
            'borderwidth': 1,
            'bordercolor': "#233347",
            'steps': steps,
            'threshold': {
                'line': {'color': "red", 'width': 3},
                'thickness': 0.75,
                'value': danger if danger else max_val
            }
        },
        number={
            'valueformat': format_str,
            'font': {'size': 22, 'color': '#FFFFFF', 'family': 'Share Tech Mono'}
        }
    ))
    fig.update_layout(
        paper_bgcolor='rgba(0,0,0,0)',
        plot_bgcolor='rgba(0,0,0,0)',
        margin=dict(l=10, r=10, t=30, b=10),
        height=135,
        width=135
    )
    return fig

def make_eicas_bar(value, min_val, max_val, title, unit, color="#00FF66", warning=None, danger=None):
    """HTML/CSSで航空機風のシャープな縦型インジケーターを生成"""
    pct = min(100.0, max(0.0, ((value - min_val) / (max_val - min_val)) * 100)) if max_val > min_val else 0
    bar_color = color
    if warning and value >= warning:
        bar_color = "#FF9900"
    if danger and value >= danger:
        bar_color = "#FF0000"
        
    warning_line = f"<div style='position: absolute; bottom: {((warning-min_val)/(max_val-min_val)*100)}%; left: 0; width: 100%; height: 2px; background-color: #FF9900;'></div>" if warning else ""
    danger_line = f"<div style='position: absolute; bottom: {((danger-min_val)/(max_val-min_val)*100)}%; left: 0; width: 100%; height: 2px; background-color: #FF0000;'></div>" if danger else ""
    
    html = f"""
    <div style="text-align: center; font-family: 'Share Tech Mono', monospace; width: 85px; margin: auto;">
        <div style="font-size: 0.75em; color: #00E5FF; font-weight: bold; height: 32px; line-height: 14px;">{title}<br><span style="font-size: 0.7em; color: #5d7a96;">{unit}</span></div>
        <div style="height: 100px; width: 16px; background-color: #0b111e; border: 1px solid #233347; margin: 8px auto; position: relative; border-radius: 1px;">
            <div style="position: absolute; bottom: 0; left: 0; width: 100%; height: {pct}%; background-color: {bar_color}; box-shadow: 0 0 6px {bar_color}; transition: height 0.2s ease;"></div>
            {warning_line}
            {danger_line}
        </div>
        <div style="font-size: 1.1em; color: #FFF; font-weight: bold;">{value:.0f}</div>
    </div>
    """
    return html

# 5. 計器パネル盤の描画
st.markdown('<div class="instrument-panel">', unsafe_allow_html=True)

# 1行目: N1(スロットル出力%) & 実回転数(RPM)
col_a, col_b = st.columns(2)
with col_a:
    n1_val = (current_power / max_power) * 100 if max_power > 0 else 0
    fig_n1 = make_eicas_gauge(
        value=n1_val,
        min_val=0,
        max_val=120,
        title="N1 (THRUST)",
        unit="%",
        color="#00FF66",
        warning=100,
        danger=105,
        format_str=".1f"
    )
    st.plotly_chart(fig_n1, use_container_width=True, config={'displayModeBar': False})

with col_b:
    fig_rpm = make_eicas_gauge(
        value=current_rpm,
        min_val=0,
        max_val=max_rpm * 1.15,
        title="ENGINE RPM",
        unit="rpm",
        color="#00E5FF",
        warning=rated_rpm,
        danger=max_rpm,
        format_str=".0f"
    )
    st.plotly_chart(fig_rpm, use_container_width=True, config={'displayModeBar': False})

# 2行目: 燃料流量 (FF) & 推定燃料消費率 (SFC)
col_c, col_d = st.columns(2)
with col_c:
    max_ff_est = (max_power * base_sfc * 1.5) / 1000 / density if density > 0 else 100
    fig_ff = make_eicas_gauge(
        value=fuel_flow_lh,
        min_val=0,
        max_val=max_ff_est,
        title="FUEL FLOW",
        unit="L / hr",
        color="#FFCC00",
        format_str=".1f"
    )
    st.plotly_chart(fig_ff, use_container_width=True, config={'displayModeBar': False})

with col_d:
    fig_sfc = make_eicas_gauge(
        value=calc_sfc,
        min_val=0,
        max_val=400,
        title="SFC (CONS)",
        unit="g / PS·h",
        color="#FF66CC",
        warning=base_sfc * 1.25,
        danger=base_sfc * 1.5,
        format_str=".1f"
    )
    st.plotly_chart(fig_sfc, use_container_width=True, config={'displayModeBar': False})

st.markdown("<hr style='border-color: #233347; margin: 12px 0 8px 0;'>", unsafe_allow_html=True)

# 3行目: 縦型バー＆システムステータス (EGT / POWER / STATUS)
col_e, col_f, col_g = st.columns(3)

with col_e:
    html_egt = make_eicas_bar(
        value=egt,
        min_val=0,
        max_val=850,
        title="EGT",
        unit="°C",
        color="#00FF66",
        warning=710,
        danger=780
    )
    st.markdown(html_egt, unsafe_allow_html=True)

with col_f:
    html_pwr = make_eicas_bar(
        value=current_power,
        min_val=0,
        max_val=max_power * 1.15,
        title="POWER",
        unit="PS",
        color="#00E5FF",
        warning=rated_power,
        danger=max_power
    )
    st.markdown(html_pwr, unsafe_allow_html=True)

with col_g:
    # 航空機コックピット風ステータス・表示器
    sys_color = "#00FF66"
    sys_status = "NORMAL"
    if current_throttle > 100 or current_rpm > max_rpm:
        sys_color = "#FF0000"
        sys_status = "O_SPEED"
    elif current_throttle > 90 or current_rpm > rated_rpm:
        sys_color = "#FF9900"
        sys_status = "CAUTION"
    elif current_rpm == 0:
        sys_color = "#888888"
        sys_status = "STBY"

    html_status = f"""
    <div style="text-align: center; font-family: 'Share Tech Mono', monospace; width: 85px; margin: auto;">
        <div style="font-size: 0.75em; color: #00E5FF; font-weight: bold; height: 32px; line-height: 14px;">SYS<br><span style="font-size: 0.7em; color: #5d7a96;">STATUS</span></div>
        <div style="height: 100px; display: flex; flex-direction: column; justify-content: center; align-items: center; border: 1px solid #233347; background-color: #0b111e; margin: 8px auto; border-radius: 2px; padding: 2px;">
            <div style="font-size: 0.65em; color: #5d7a96; text-transform: uppercase;">FUEL-TYP</div>
            <div style="font-size: 0.7em; color: #FFF; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 75px;">{fuel_info['label']}</div>
            <div style="margin-top: 12px; font-size: 0.65em; color: #5d7a96; text-transform: uppercase;">ENGINE</div>
            <div style="font-size: 0.85em; color: {sys_color}; font-weight: bold; text-shadow: 0 0 5px {sys_color};">{sys_status}</div>
        </div>
        <div style="font-size: 0.7em; color: #5d7a96;">SYS REV_C</div>
    </div>
    """
    st.markdown(html_status, unsafe_allow_html=True)

st.markdown('</div>', unsafe_allow_html=True)
