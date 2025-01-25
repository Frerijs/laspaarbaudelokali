import streamlit as st
import streamlit.components.v1 as components
import os

st.set_page_config(page_title="LAS + CSV Salīdzinājums", layout="wide")

st.title("LAS + CSV Salīdzinājums ar Klienta Puses Apstrādi")

# Iebūvēt HTML failu
HtmlFile = open(os.path.join("assets", "index.html"), 'r', encoding='utf-8')
source_code = HtmlFile.read() 
HtmlFile.close()

# Iebūvēt HTML ar komponentu
components.html(source_code, height=800, scrolling=True)
