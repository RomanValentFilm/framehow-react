THE NEW FRONT PAGE — how it is made (29 Oct).

  template.html            the page, with {{WORKFLOW}} where the steps go
  template-with-strips.html  the earlier look: grey strips behind each step's text
  texts.json               the step texts, one per slide of "Tutorial PDF.pdf"
  build.py                 puts them together:

    python3 site/dev-src/build.py site/dev-src/texts.json site/public-dev/index.html site/dev-src/template.html

Pictures: site/public-dev/img/wf/NN.jpg (2360 px) and NN-1200.jpg (phones), taken
from "Workflow presentation 01.pdf" (uncompressed), the iPad's time bar cut off
(top 45 px; picture 13 had none).
