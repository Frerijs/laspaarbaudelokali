import streamlit as st
import requests
import datetime
from zoneinfo import ZoneInfo

# ======================================================================
#                         SUPABASE AUTORIZĀCIJA
# ======================================================================

supabase_url = "https://uhwbflqdripatfpbbetf.supabase.co"
supabase_key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVod2JmbHFkcmlwYXRmcGJiZXRmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMDcxODE2MywiZXhwIjoyMDQ2Mjk0MTYzfQ.78wsNZ4KBg2l6zeZ1ZknBBooe0PeLtJzRU-7eXo3WTk"

APP_NAME = "LAS-CSV Salīdzināšana"
APP_VERSION = "1.0"
APP_TYPE = "web"

def authenticate(username, password):
    """
    Pārbauda, vai lietotājvārds un parole eksistē Supabase tabulā `users`.
    """
    try:
        headers = {
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}",
            "Content-Type": "application/json",
        }
        url = f"{supabase_url}/rest/v1/users"
        params = {
            "select": "*",
            "username": f"eq.{username}",
            "password": f"eq.{password}",
        }
        response = requests.get(url, headers=headers, params=params)
        return response.status_code == 200 and len(response.json()) > 0
    except Exception as e:
        st.error(f"Kļūda: {str(e)}")
        return False

def log_user_login(username):
    """
    Pieraksta lietotāja pieslēgšanās brīdi Supabase tabulā `user_data`.
    """
    try:
        riga_tz = ZoneInfo('Europe/Riga')
        current_time = datetime.datetime.now(riga_tz).isoformat()

        data = {
            "username": username,
            "App": APP_NAME,
            "Ver": APP_VERSION,
            "app_type": APP_TYPE,
            "login_time": current_time
        }

        headers = {
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}",
            "Content-Type": "application/json"
        }
        url = f"{supabase_url}/rest/v1/user_data"
        response = requests.post(url, json=data, headers=headers)
        if response.status_code not in [200, 201]:
            st.error(f"Kļūda ierakstot datus: {response.status_code}, {response.text}")
    except Exception as e:
        st.error(f"Kļūda: {str(e)}")

def login():
    """
    Apstrādā lietotāja autentifikāciju.
    """
    username = st.session_state.get('username', '').strip()
    password = st.session_state.get('password', '').strip()
    if username and password:
        if authenticate(username, password):
            st.session_state.logged_in = True
            st.session_state.username_logged = username
            log_user_login(username)
        else:
            st.error("Nepareizs lietotājvārds vai parole.")

def show_login():
    """
    Attēlo pieteikšanās formu.
    """
    st.title("CSV un LAS salīdzināšana")
    with st.form(key='login_form'):
        st.text_input("Lietotājvārds", key='username')
        st.text_input("Parole", type="password", key='password')
        st.form_submit_button(label="Pieslēgties", on_click=login)
    st.markdown("<div style='text-align: center; margin-top: 20px; color: gray;'>© 2025 METRUM</div>", unsafe_allow_html=True)

# ======================================================================
#                         FRONTEND + PYODIDE
# ======================================================================

def app_main():
    """
    Galvenā aplikācijas daļa, kur notiek failu augšupielāde un vizualizācija.
    """
    st.title("CSV un LAS salīdzināšana (Pyodide)")

    st.markdown("### 1️⃣ Augšupielādē failus")
    las_file = st.file_uploader("Augšupielādē .las/.laz failu", type=["las", "laz"])
    csv_file = st.file_uploader("Augšupielādē .csv failu", type=["csv"])

    max_dist = st.number_input("Maksimālais attālums (m)", 0.0, 1000.0, 0.2, 0.1)

    if las_file and csv_file:
        las_data = las_file.getvalue().hex()
        csv_data = csv_file.getvalue().decode("utf-8")

        st.markdown("## Apstrāde notiks lietotāja pusē (Pyodide)")

        # Ievieto Pyodide + JavaScript skriptu
        st.markdown(f"""
        <script>
        async function runPyodideProcessing() {{
            let pyodide = await loadPyodide();
            await pyodide.loadPackage(["numpy", "pandas", "scipy"]);
            console.log("Pyodide ielādēts!");

            let code = `
import laspy
import pandas as pd
import numpy as np
from scipy.spatial import cKDTree
from io import BytesIO, StringIO

def process_files(las_hex, csv_data, max_dist):
    las_bytes = bytes.fromhex(las_hex)
    las_file = BytesIO(las_bytes)
    las = laspy.read(las_file)
    
    ground_mask = (las.classification == 2)
    X, Y, Z = las.x[ground_mask], las.y[ground_mask], las.z[ground_mask]
    las_points = np.vstack((X, Y, Z)).T

    csv_df = pd.read_csv(StringIO(csv_data))
    required_cols = {{'X', 'Y', 'Z'}}
    if not required_cols.issubset(csv_df.columns):
        return "CSV failam jābūt X, Y, Z kolonnām!"
    
    las_xy = las_points[:, :2]
    tree = cKDTree(las_xy)
    csv_df['LAS_Z'] = np.nan
    csv_df['Z_diff'] = np.nan

    for i, (x, y) in enumerate(csv_df[['X', 'Y']].values):
        dist, idx = tree.query([x, y], k=1)
        if dist <= max_dist:
            csv_df.at[i, 'LAS_Z'] = las_points[idx, 2]
            csv_df.at[i, 'Z_diff'] = csv_df.at[i, 'Z'] - las_points[idx, 2]

    return csv_df.to_csv(index=False)

result = process_files(pyodide.globals['las_hex'], pyodide.globals['csv_data'], {max_dist})
            `;

            pyodide.globals.set("las_hex", "{las_data}");
            pyodide.globals.set("csv_data", `{csv_data}`);

            pyodide.runPython(code);
            let output = pyodide.globals.get("result");

            document.querySelector("[data-testid='stTextArea']").value = output;
        }}

        let btn = document.createElement("button");
        btn.innerText = "Sākt apstrādi";
        btn.onclick = runPyodideProcessing;
        document.body.appendChild(btn);
        </script>
        <script src="https://cdn.jsdelivr.net/pyodide/v0.20.0/full/pyodide.js"></script>
        """, unsafe_allow_html=True)

    if st.button("Iziet"):
        st.session_state.logged_in = False
        st.success("Veiksmīgi izgājāt no konta.")

# ======================================================================
#                           GALVENAIS IEEJAS PUNKTS
# ======================================================================

if 'logged_in' not in st.session_state:
    st.session_state.logged_in = False

if not st.session_state.logged_in:
    show_login()
else:
    app_main()
