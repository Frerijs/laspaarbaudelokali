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

# Iebūvēt HTML/JS kodu ar Streamlit komponentu
HtmlFile = open(os.path.join("assets", "index.html"), 'r', encoding='utf-8')
source_code = HtmlFile.read() 
HtmlFile.close()

# Izvietot HTML kodu ar Streamlit komponentu
st.components.v1.html(source_code, height=1500, scrolling=True)
