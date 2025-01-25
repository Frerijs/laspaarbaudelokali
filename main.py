import streamlit as st
import streamlit.components.v1 as components
import os

# Iestatījumi
st.set_page_config(page_title="LAS + CSV Salīdzinājums", layout="wide")

# Galvenais virsraksts
st.title("LAS + CSV Salīdzinājums ar Klienta Puses Apstrādi")

# Informācijas sadaļa
st.markdown("""
Šis rīks ļauj salīdzināt LAS failu ar CSV punktiem, veikt statistiku un veikt kļūdu klasifikāciju. 
Apstrāde notiek pilnībā klienta pusē, tādējādi izmantojot jūsu pārlūkprogrammas CPU un RAM resursus.
""")

# Izmantojiet kolonnu izkārtojumu
col1, col2 = st.columns([1, 3])

with col1:
    st.header("Instrukcijas")
    st.markdown("""
    1. **LAS fails**: Klikšķiniet uz "Augšupielādēt LAS failu" un izvēlieties LAS failu ar EPSG:3059 koordinātu sistēmu.
    2. **CSV fails**: Klikšķiniet uz "Augšupielādēt CSV failu" un izvēlieties CSV failu ar EPSG:3059, x, y, z kolonnām.
    3. **Meklēšanas attālums**: Norādiet attālumu metros, kurā meklēt tuvākos punktus.
    4. **Sākt apstrādi**: Klikšķiniet uz "Sākt apstrādi", lai sāktu datu apstrādi.
    5. **Rezultāti**: Pēc apstrādes rezultāti tiks rādīti zemāk, un jūs varēsiet lejupielādēt rezultātus kā CSV vai DXF failu.
    """)

with col2:
    # Iebūvēt HTML kodu ar Streamlit komponentu
    HtmlFile = open(os.path.join("assets", "index.html"), 'r', encoding='utf-8')
    source_code = HtmlFile.read() 
    HtmlFile.close()

    st.components.v1.html(source_code, height=1600, scrolling=True)
