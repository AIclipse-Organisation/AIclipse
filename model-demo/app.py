from flask import Flask, render_template, request, redirect, url_for
from predictor import predict_image
import os

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'static/uploads'
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

@app.route('/', methods=['GET', 'POST'])
def index():
    if request.method == 'POST':
        file = request.files.get('image')
        if not file or file.filename == '':
            return render_template('index.html', error='No file selected')

        filepath = os.path.join(app.config['UPLOAD_FOLDER'], file.filename)
        file.save(filepath)
        label,confidence = predict_image(filepath)
        return redirect(url_for('result', filename=file.filename, label=label, confidence=confidence))

    return render_template('index.html')

@app.route('/result')
def result():
    filename = request.args.get('filename')
    label = request.args.get('label')
    confidence = request.args.get('confidence')

    # if accessed directly without params, redirect to home
    if not filename or not label or confidence is None:
        return redirect(url_for('index'))

    confidence = float(confidence)
    return render_template('result.html',filename=filename,label=label,confidence=confidence)

if __name__ == '__main__':
    app.run(debug=True)