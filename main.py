# main.py

import streamlit as st
import pandas as pd
import laspy
import numpy as np
import io
from scipy.spatial import cKDTree
import base64

st.set_page_config(page_title="LAS + CSV Salīdzinājums", layout="wide")

st.title("LAS (Ground=2) un CSV Salīdzināšana + Kļūdu Klasifikācija")

st.markdown("""
Šis rīks ļauj salīdzināt LAS failu ar CSV punktiem, veikt statistiku un veikt kļūdu klasifikāciju.
""")

# Sānjosla ievadei
st.sidebar.header("Ievade")

las_file = st.sidebar.file_uploader("Augšupielādēt LAS failu (EPSG:3059)", type=["las"])
csv_file = st.sidebar.file_uploader("Augšupielādēt CSV failu (EPSG:3059, x,y,z)", type=["csv", "txt"])
max_distance = st.sidebar.number_input("Meklēšanas attālums (m)", min_value=0.01, value=0.2, step=0.01)

process = st.sidebar.button("Sākt apstrādi")

if process:
    if not las_file or not csv_file:
        st.error("Lūdzu, augšupielādējiet gan LAS, gan CSV failu!")
    else:
        try:
            with st.spinner("Nolasām CSV..."):
                # Parsējam CSV
                df_csv = pd.read_csv(csv_file)
                # Pārliecināmies, ka kolonnas ir x, y, z (bez lielajiem burtiem)
                df_csv.columns = [col.strip().lower() for col in df_csv.columns]
                if not {'x', 'y', 'z'}.issubset(df_csv.columns):
                    st.error("CSV failam jāietver kolonnas: x, y, z.")
                    st.stop()
                csv_points = df_csv[['x', 'y', 'z']].dropna()
                csv_points = csv_points.astype(float).reset_index(drop=True)
                csv_array = csv_points[['x', 'y']].values

            with st.spinner("Nolasām LAS galveni..."):
                # Nolasām LAS galveni
                las = laspy.read(las_file)
                if las.header.epsg != 3059:
                    st.warning("LAS faila EPSG nav 3059. Pārliecinieties, ka koordinātas ir pareizajā sistēmā.")

                las_points = las.points
                classifications = las.classification
                ground_mask = classifications == 2
                las_ground = las_points[ground_mask]
                las_ground_xyz = np.vstack((
                    las_ground.X * las.header.scale[0] + las.header.offset[0],
                    las_ground.Y * las.header.scale[1] + las.header.offset[1],
                    las_ground.Z * las.header.scale[2] + las.header.offset[2]
                )).T
                las_ground_xy = las_ground_xyz[:, :2]

            with st.spinner("Veidojam KD Koku no LAS ground punktiem..."):
                # Veidojam telpisko indeksu
                tree = cKDTree(las_ground_xy)

            with st.spinner("Meklējam tuvākos punktus..."):
                # Meklējam tuvākos kaimiņus noteiktā attālumā
                distances, indices = tree.query(csv_array, distance_upper_bound=max_distance)

                # Inicializējam rezultātus
                results = []
                dz_list = []

                for i, (dist, idx) in enumerate(zip(distances, indices)):
                    if idx != len(las_ground_xy):  # cKDTree atgriež len(data), ja nav atrasts kaimiņš
                        las_x, las_y, las_z = las_ground_xyz[idx]
                        csv_z = csv_points.loc[i, 'z']
                        dz = csv_z - las_z
                        results.append({
                            'CSV X': csv_points.loc[i, 'x'],
                            'CSV Y': csv_points.loc[i, 'y'],
                            'CSV Z': csv_z,
                            'LAS X': las_x,
                            'LAS Y': las_y,
                            'LAS Z': las_z,
                            'Dist (m)': round(dist, 3),
                            'ΔZ (m)': round(dz, 3)
                        })
                        dz_list.append(dz)

            if results:
                df_results = pd.DataFrame(results)

                # Statistika
                min_dz = df_results['ΔZ (m)'].min()
                max_dz = df_results['ΔZ (m)'].max()
                mean_dz = df_results['ΔZ (m)'].mean()
                rmse = np.sqrt(np.mean(np.square(df_results['ΔZ (m)'])))

                # Klasifikācija
                def classify(dz_abs):
                    if dz_abs <= 0.1:
                        return 'zaļa'
                    elif dz_abs <= 0.2:
                        return 'oranža'
                    elif dz_abs <= 0.5:
                        return 'sarkana'
                    elif dz_abs <= 1.0:
                        return 'zilā'
                    else:
                        return 'violetā'

                df_results['Klasifikācija'] = df_results['ΔZ (m)'].abs().apply(classify)

                # Klasifikāciju skaits
                classification_counts = df_results['Klasifikācija'].value_counts().reindex(['zaļa', 'oranža', 'sarkana', 'zilā', 'violetā'], fill_value=0)

                # Parādām statistiku
                st.subheader("Statistika")
                stat_col1, stat_col2 = st.columns(2)
                with stat_col1:
                    st.markdown(f"- **Salīdzināto punktu skaits:** {len(df_results)}")
                    st.markdown(f"- **Minimālā starpība (ΔZ):** {min_dz:.3f} m")
                    st.markdown(f"- **Maksimālā starpība (ΔZ):** {max_dz:.3f} m")
                with stat_col2:
                    st.markdown(f"- **Vidējā starpība (ΔZ):** {mean_dz:.3f} m")
                    st.markdown(f"- **Kvadrātiskā vidējā kļūda (RMSE):** {rmse:.3f} m")

                # Parādam klasifikāciju
                st.subheader("Kļūdu klasifikācija (|ΔZ|)")
                classification_df = pd.DataFrame({
                    'Interval': ['līdz 0.1 m', '0.1–0.2 m', '0.2–0.5 m', '0.5–1.0 m', 'virs 1.0 m'],
                    'Krāsa': ['zaļa', 'oranža', 'sarkana', 'zilā', 'violetā'],
                    'Punktu skaits': classification_counts.values
                })

                # Definējam krāsas rindām
                colors = ['#afffa6', '#ffeaa6', '#ffaaaa', '#aaaaff', '#e6a6ff']
                classification_df['Row Color'] = colors

                def color_row(row):
                    return [f'background-color: {row["Row Color"]}'] * len(row)

                styled_classification = classification_df.style.apply(color_row, axis=1).hide_index()
                st.table(styled_classification.drop('Row Color', axis=1))

                # Parādam rezultātu tabulu
                st.subheader("Rezultāti")
                st.dataframe(df_results.style.format({
                    'CSV X': "{:.3f}",
                    'CSV Y': "{:.3f}",
                    'CSV Z': "{:.3f}",
                    'LAS X': "{:.3f}",
                    'LAS Y': "{:.3f}",
                    'LAS Z': "{:.3f}",
                    'Dist (m)': "{:.3f}",
                    'ΔZ (m)': "{:.3f}"
                }))

                # Lejupielādējam CSV
                csv_buffer = io.StringIO()
                df_results.to_csv(csv_buffer, index=False)
                csv_data = csv_buffer.getvalue()
                b64 = base64.b64encode(csv_data.encode()).decode()
                href = f'<a href="data:file/csv;base64,{b64}" download="rezultati.csv">📥 Lejupielādēt CSV</a>'
                st.markdown(href, unsafe_allow_html=True)
            else:
                st.warning("Neviens CSV punkts nav tuvā ground LAS punktam!")

        except Exception as e:
            st.error(f"Kļūda: {e}")
